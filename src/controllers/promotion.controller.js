"use strict";

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");
const { computeStudentAverages } = require("../utils/promotionMath");
const { decidePromotion } = require("../utils/promotionDecision.util");

// Tuned for the production VPS's 1GB RAM. Small chunks, raw/lean queries,
// each chunk its own transaction (see docstring on runExecutor below).
const CHUNK_SIZE = 25;
const CHUNK_YIELD_MS = 25; // small pause between chunks so the event loop
// keeps serving other requests instead of hogging the process.
const STALL_TIMEOUT_MS = 2 * 60 * 1000; // no progress in 2 minutes = stalled
const WATCHDOG_INTERVAL_MS = 60 * 1000;

// Same auto-create-if-missing bootstrap used by every other module in
// src/ (see promotionRequirement.controller.js's initPromotionRequirement)
// so these tables exist on any environment the server connects to,
// without needing a manual migration/sync step first. force:false only
// creates a table when it's absent, never touches an existing one.
async function initPromotionTables() {
  const targets = [
    models.PromotionRun,
    models.PromotionRunMove,
    models.StudentPromotion,
    models.PromotionRunLock,
  ];
  try {
    const existingTables = await models.PromotionRun.sequelize
      .getQueryInterface()
      .showAllTables();
    for (const model of targets) {
      if (!existingTables.includes(model.getTableName())) {
        await model.sync({ force: false });
      }
    }
  } catch (err) {
    console.error("[Promotion] Failed to initialize promotion tables:", err.message);
  }
}
initPromotionTables();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitProgress(userId, event, payload) {
  try {
    const { emitToUser } = require("../desktop-module/socket/index");
    emitToUser(userId, event, payload);
  } catch (err) {
    // Sockets not initialized (e.g. in a script/test context), polling
    // still works, so this is safe to swallow.
  }
}

// ─── Lean data access (deliberately NOT reusing reportCard.controller.js,
// see project decision: that file's eager-loaded query shape already
// strains the production VPS, and promotion can run at a bigger scope than
// any single report-card request ever does) ────────────────────────────

async function buildSubjectMeta(classId) {
  const rows = await models.ClassSubject.findAll({
    where: { class_id: classId },
    include: [
      {
        association: models.ClassSubject.associations.subject,
        attributes: ["id", "name", "category", "coefficient"],
      },
    ],
    attributes: [],
    raw: true,
    nest: true,
  });

  const meta = new Map();
  for (const row of rows) {
    const s = row.subject;
    if (s && !meta.has(s.id)) {
      meta.set(s.id, {
        category: s.category,
        coefficient: s.coefficient,
        name: s.name,
      });
    }
  }
  return meta;
}

async function fetchActiveStudentIds(classId, academicYearId) {
  const rows = await models.Student.findAll({
    where: { class_id: classId, academic_year_id: academicYearId, status: "active" },
    attributes: ["id"],
    order: [["id", "ASC"]],
    raw: true,
  });
  return rows.map((r) => r.id);
}

async function fetchMarksByStudent(studentIds, classId, academicYearId) {
  if (!studentIds.length) return new Map();
  const rows = await models.Mark.findAll({
    where: {
      student_id: { [Op.in]: studentIds },
      class_id: classId,
      academic_year_id: academicYearId,
    },
    include: [
      {
        association: models.Mark.associations.sequence,
        attributes: ["order_number"],
      },
    ],
    attributes: ["student_id", "subject_id", "score"],
    raw: true,
    nest: true,
  });

  const byStudent = new Map();
  for (const r of rows) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
    byStudent.get(r.student_id).push({
      subject_id: r.subject_id,
      score: r.score,
      sequence_order: r.sequence?.order_number,
    });
  }
  return byStudent;
}

function computeAndDecide(marksForStudent, subjectMeta, requirement) {
  const { subjectAverages, annualAverage, hasIncompleteData, gaps } =
    computeStudentAverages(marksForStudent || [], subjectMeta);
  const { decision, reasons } = decidePromotion(
    annualAverage,
    subjectAverages,
    requirement
  );
  return { annualAverage, decision, reasons, hasIncompleteData, gaps };
}

async function loadEffectiveRequirement(classId, academicYearId, averageOverride) {
  const row = await models.PromotionRequirement.findOne({
    where: { academic_year_id: academicYearId, class_id: classId },
  });
  if (!row) return null;
  const requirement = row.get({ plain: true });
  if (averageOverride !== undefined && averageOverride !== null) {
    requirement.min_average = averageOverride;
  }
  return requirement;
}

function checkRequirementDrift(requirement, subjectMeta) {
  const errors = [];
  const missingGeneral = requirement.compulsory_general_subject_ids.filter(
    (id) => !subjectMeta.has(id) || subjectMeta.get(id).category !== "general"
  );
  const missingProfessional =
    requirement.compulsory_professional_subject_ids.filter(
      (id) =>
        !subjectMeta.has(id) || subjectMeta.get(id).category !== "professional"
    );
  if (missingGeneral.length) {
    errors.push(
      `Compulsory General subject id(s) no longer taught in this class: ${missingGeneral.join(
        ", "
      )}, fix this class's promotion requirements before running promotion`
    );
  }
  if (missingProfessional.length) {
    errors.push(
      `Compulsory Professional subject id(s) no longer taught in this class: ${missingProfessional.join(
        ", "
      )}, fix this class's promotion requirements before running promotion`
    );
  }
  return errors;
}

// ─── Preview (read-only, one class/move at a time, no mutex needed) ────

const previewMove = catchAsync(async (req, res, next) => {
  const {
    source_class_id,
    destination_class_id,
    is_graduation,
    academic_year_from_id,
    academic_year_to_id,
    manual_average_override,
  } = req.body;

  if (!source_class_id || !academic_year_from_id || !academic_year_to_id) {
    return next(
      new AppError(
        "source_class_id, academic_year_from_id and academic_year_to_id are required",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (!is_graduation && !destination_class_id) {
    return next(
      new AppError(
        "destination_class_id is required unless this is a graduation move",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const sourceClass = await models.Class.findByPk(source_class_id);
  if (!sourceClass) return next(new AppError("Source class not found", 404));

  let destinationClass = null;
  if (!is_graduation) {
    destinationClass = await models.Class.findByPk(destination_class_id);
    if (!destinationClass)
      return next(new AppError("Destination class not found", 404));
    if (destinationClass.department_id !== sourceClass.department_id) {
      return next(
        new AppError(
          "Destination class must be in the same department as the source class",
          StatusCodes.BAD_REQUEST
        )
      );
    }
  }

  const requirement = await loadEffectiveRequirement(
    source_class_id,
    academic_year_from_id,
    manual_average_override
  );
  if (!requirement) {
    return next(
      new AppError(
        "No promotion requirements configured for this class and academic year",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const subjectMeta = await buildSubjectMeta(source_class_id);
  const configurationErrors = checkRequirementDrift(requirement, subjectMeta);

  if (configurationErrors.length) {
    return appResponder(
      StatusCodes.OK,
      {
        source_class: { id: sourceClass.id, name: sourceClass.name },
        destination_class: destinationClass
          ? { id: destinationClass.id, name: destinationClass.name }
          : null,
        blocked: true,
        configuration_errors: configurationErrors,
        results: [],
        summary: {},
      },
      res
    );
  }

  const studentIds = await fetchActiveStudentIds(
    source_class_id,
    academic_year_from_id
  );

  const results = [];
  for (let i = 0; i < studentIds.length; i += CHUNK_SIZE) {
    const chunk = studentIds.slice(i, i + CHUNK_SIZE);
    const [marksByStudent, students] = await Promise.all([
      fetchMarksByStudent(chunk, source_class_id, academic_year_from_id),
      models.Student.findAll({
        where: { id: { [Op.in]: chunk } },
        attributes: ["id", "full_name", "student_id"],
        raw: true,
      }),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));

    for (const studentId of chunk) {
      const outcome = computeAndDecide(
        marksByStudent.get(studentId),
        subjectMeta,
        requirement
      );
      const st = studentMap.get(studentId);
      results.push({
        student_id: studentId,
        name: st?.full_name,
        registration_number: st?.student_id,
        overall_average: outcome.annualAverage,
        decision: outcome.decision,
        reasons: outcome.reasons,
        has_incomplete_data: outcome.hasIncompleteData,
        gaps: outcome.gaps,
      });
    }
  }

  const summary = {
    total: results.length,
    promoted: results.filter((r) => r.decision === "promoted").length,
    promoted_on_condition: results.filter(
      (r) => r.decision === "promoted_on_condition"
    ).length,
    failed: results.filter((r) => r.decision === "failed").length,
    incomplete_data_count: results.filter((r) => r.has_incomplete_data).length,
  };

  return appResponder(
    StatusCodes.OK,
    {
      source_class: { id: sourceClass.id, name: sourceClass.name },
      destination_class: destinationClass
        ? { id: destinationClass.id, name: destinationClass.name }
        : null,
      is_graduation: !!is_graduation,
      requirement,
      blocked: false,
      configuration_errors: [],
      results,
      summary,
    },
    res
  );
});

// ─── Mutex ────────────────────────────────────────────────────────────

async function acquireRunLock(runId) {
  await models.PromotionRunLock.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, current_run_id: null },
  });
  const [updatedCount] = await models.PromotionRunLock.update(
    { current_run_id: runId, locked_at: new Date() },
    { where: { id: 1, current_run_id: null } }
  );
  return updatedCount === 1;
}

async function releaseRunLock(runId) {
  await models.PromotionRunLock.update(
    { current_run_id: null },
    { where: { id: 1, current_run_id: runId } }
  );
}

// ─── Start a run ─────────────────────────────────────────────────────

const startRun = catchAsync(async (req, res, next) => {
  const {
    scope,
    academic_year_from_id,
    academic_year_to_id,
    moves, // [{ source_class_id, destination_class_id|null, is_graduation, manual_average_override }]
  } = req.body;

  if (!["class", "department", "school", "manual"].includes(scope)) {
    return next(new AppError("Invalid scope", StatusCodes.BAD_REQUEST));
  }
  if (!academic_year_from_id || !academic_year_to_id) {
    return next(
      new AppError(
        "academic_year_from_id and academic_year_to_id are required",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (!Array.isArray(moves) || moves.length === 0) {
    return next(
      new AppError("At least one move is required", StatusCodes.BAD_REQUEST)
    );
  }

  const fromYear = await models.AcademicYear.findByPk(academic_year_from_id);
  if (!fromYear || fromYear.status !== "active") {
    return next(
      new AppError(
        "Promotion can only be run against the currently active academic year",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const sourceClassIds = moves.map((m) => m.source_class_id);
  if (new Set(sourceClassIds).size !== sourceClassIds.length) {
    return next(
      new AppError(
        "Each source class can only appear once in a run",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Validate + snapshot requirements for every move before creating anything.
  const preparedMoves = [];
  for (const move of moves) {
    const sourceClass = await models.Class.findByPk(move.source_class_id);
    if (!sourceClass) {
      return next(
        new AppError(`Source class ${move.source_class_id} not found`, 404)
      );
    }

    // A given (class, source year) pair may only ever have one live
    // (non-reversed) promotion move. Re-running it without reversing the
    // existing one first would create confusing duplicate history and
    // double-process whichever students are still sitting there.
    const existingMove = await models.PromotionRunMove.findOne({
      where: {
        source_class_id: move.source_class_id,
        status: { [Op.ne]: "reversed" },
      },
      include: [
        {
          association: models.PromotionRunMove.associations.run,
          where: { academic_year_from_id },
          attributes: [],
          required: true,
        },
      ],
    });
    if (existingMove) {
      return next(
        new AppError(
          `${sourceClass.name} was already promoted out of this academic year (move #${existingMove.id}, status: ${existingMove.status}). Reverse that move before running promotion for this class again.`,
          StatusCodes.CONFLICT
        )
      );
    }

    let destinationClass = null;
    if (!move.is_graduation) {
      if (!move.destination_class_id) {
        return next(
          new AppError(
            `A destination class is required for source class ${sourceClass.name} unless it is a graduation move`,
            StatusCodes.BAD_REQUEST
          )
        );
      }
      destinationClass = await models.Class.findByPk(move.destination_class_id);
      if (!destinationClass) {
        return next(
          new AppError(`Destination class ${move.destination_class_id} not found`, 404)
        );
      }
      if (destinationClass.department_id !== sourceClass.department_id) {
        return next(
          new AppError(
            `Destination class must be in the same department as ${sourceClass.name}`,
            StatusCodes.BAD_REQUEST
          )
        );
      }
    }

    const requirement = await loadEffectiveRequirement(
      move.source_class_id,
      academic_year_from_id,
      move.manual_average_override
    );
    if (!requirement) {
      return next(
        new AppError(
          `No promotion requirements configured for ${sourceClass.name} in this academic year`,
          StatusCodes.BAD_REQUEST
        )
      );
    }

    const subjectMeta = await buildSubjectMeta(move.source_class_id);
    const configErrors = checkRequirementDrift(requirement, subjectMeta);
    if (configErrors.length) {
      return next(
        new AppError(
          `${sourceClass.name}: ${configErrors.join("; ")}`,
          StatusCodes.BAD_REQUEST
        )
      );
    }

    preparedMoves.push({
      source_class_id: move.source_class_id,
      destination_class_id: move.is_graduation ? null : move.destination_class_id,
      is_graduation: !!move.is_graduation,
      requirement_snapshot: requirement,
    });
  }

  // Acquire the global mutex up front, using a placeholder run id of 0 is
  // not possible, create the run row first (status pending, harmless if
  // we have to roll back), then try to acquire the lock against its id.
  const run = await models.PromotionRun.create({
    scope,
    academic_year_from_id,
    academic_year_to_id,
    status: "pending",
    initiated_by: req.user.id,
  });

  const acquired = await acquireRunLock(run.id);
  if (!acquired) {
    await run.destroy();
    return next(
      new AppError(
        "A promotion run is already in progress. Only one run may be active at a time.",
        StatusCodes.CONFLICT
      )
    );
  }

  const moveRows = await models.PromotionRunMove.bulkCreate(
    preparedMoves.map((m) => ({
      run_id: run.id,
      source_class_id: m.source_class_id,
      destination_class_id: m.destination_class_id,
      is_graduation: m.is_graduation,
      requirement_snapshot: m.requirement_snapshot,
      status: "pending",
    })),
    { returning: true }
  );

  appResponder(
    StatusCodes.ACCEPTED,
    { run_id: run.id, status: "pending", moves: moveRows.map((m) => m.id) },
    res
  );

  // Fire and forget, this continues after the response has been sent.
  runExecutor(run.id).catch((err) => {
    console.error(`[Promotion] Run ${run.id} executor crashed:`, err);
  });
});

// ─── Executor ────────────────────────────────────────────────────────
//
// Each chunk of students is its own transaction. This isn't just about
// keeping lock duration short. It also gives us free, safe crash-resume
// points: if the process dies mid-chunk, Postgres rolls that one
// transaction back automatically, so "resume from the last committed
// chunk" is always a clean boundary, never a partially-written one.

async function processMove(run, move) {
  await move.update({
    status: "running",
    started_at: move.started_at || new Date(),
  });

  const requirement = move.requirement_snapshot;
  const subjectMeta = await buildSubjectMeta(move.source_class_id);

  const studentIds = await fetchActiveStudentIds(
    move.source_class_id,
    run.academic_year_from_id
  );
  if (move.total_students !== studentIds.length) {
    await move.update({ total_students: studentIds.length });
  }

  const startAfter = move.cursor_student_id || 0;
  const remaining = studentIds.filter((id) => id > startAfter);

  for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
    const chunk = remaining.slice(i, i + CHUNK_SIZE);
    const marksByStudent = await fetchMarksByStudent(
      chunk,
      move.source_class_id,
      run.academic_year_from_id
    );

    const t = await models.PromotionRun.sequelize.transaction();
    try {
      for (const studentId of chunk) {
        const outcome = computeAndDecide(
          marksByStudent.get(studentId),
          subjectMeta,
          requirement
        );

        const isPromotingOut = outcome.decision !== "failed";
        let toClassId;
        let toAcademicYearId;
        let newStatus = "active";

        if (!isPromotingOut) {
          // Failed, repeats the same class next year.
          toClassId = move.source_class_id;
          toAcademicYearId = run.academic_year_to_id;
        } else if (move.is_graduation) {
          toClassId = null;
          toAcademicYearId = null;
          newStatus = "graduated";
        } else {
          toClassId = move.destination_class_id;
          toAcademicYearId = run.academic_year_to_id;
        }

        await models.StudentPromotion.create(
          {
            run_id: run.id,
            run_move_id: move.id,
            student_id: studentId,
            from_class_id: move.source_class_id,
            from_academic_year_id: run.academic_year_from_id,
            to_class_id: toClassId,
            to_academic_year_id: toAcademicYearId,
            decision: outcome.decision,
            overall_average: outcome.annualAverage,
            has_incomplete_data: outcome.hasIncompleteData,
            detail_snapshot: {
              reasons: outcome.reasons,
              gaps: outcome.gaps,
            },
          },
          { transaction: t }
        );

        await models.Student.update(
          { class_id: toClassId, academic_year_id: toAcademicYearId, status: newStatus },
          { where: { id: studentId }, transaction: t }
        );
      }

      const newCursor = chunk[chunk.length - 1];
      await move.update(
        {
          processed_students: move.processed_students + chunk.length,
          cursor_student_id: newCursor,
        },
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    emitProgress(run.initiated_by, "promotionProgress", {
      run_id: run.id,
      move_id: move.id,
      processed: move.processed_students,
      total: move.total_students,
    });

    await sleep(CHUNK_YIELD_MS);
  }

  await move.update({ status: "completed", completed_at: new Date() });
}

async function runExecutor(runId) {
  const run = await models.PromotionRun.findByPk(runId);
  if (!run) return;

  if (run.status === "pending") {
    await run.update({ status: "running" });
  }

  const moves = await models.PromotionRunMove.findAll({
    where: { run_id: runId, status: { [Op.in]: ["pending", "running"] } },
    order: [["id", "ASC"]],
  });

  try {
    for (const move of moves) {
      // Re-fetch in case a watchdog cycle already advanced its cursor.
      const fresh = await models.PromotionRunMove.findByPk(move.id);
      if (fresh.status === "completed" || fresh.status === "reversed") continue;
      await processMove(run, fresh);
    }

    await run.update({ status: "completed", completed_at: new Date() });
    emitProgress(run.initiated_by, "promotionRunCompleted", { run_id: run.id });
  } catch (err) {
    console.error(`[Promotion] Run ${runId} failed:`, err);
    await run.update({ status: "failed" });
    emitProgress(run.initiated_by, "promotionRunFailed", {
      run_id: run.id,
      error: err.message,
    });
  } finally {
    await releaseRunLock(runId);
  }
}

// ─── Watchdog ────────────────────────────────────────────────────────
//
// Covers two failure shapes: (a) the process is still alive but a run
// hung (bad query, unexpected exception swallowed somewhere), and (b) the
// whole process restarted, wiping any in-flight execution. On restart
// this same scan (which starts immediately, then repeats) finds any run
// left in 'running' from a previous process lifetime and resumes it from
// its last committed chunk, exactly the same way.

async function watchdogTick() {
  try {
    const staleBefore = new Date(Date.now() - STALL_TIMEOUT_MS);
    const staleRuns = await models.PromotionRun.findAll({
      where: { status: "running", updated_at: { [Op.lt]: staleBefore } },
    });

    for (const run of staleRuns) {
      console.warn(
        `[Promotion] Run ${run.id} appears stalled (no progress since ${run.updated_at.toISOString()}), auto-resuming.`
      );
      await run.update({ interruption_count: run.interruption_count + 1 });
      emitProgress(run.initiated_by, "promotionRunInterrupted", {
        run_id: run.id,
        message:
          "The promotion process was interrupted and has been automatically resumed.",
      });
      runExecutor(run.id).catch((err) => {
        console.error(`[Promotion] Watchdog resume of run ${run.id} failed:`, err);
      });
    }
  } catch (err) {
    console.error("[Promotion] Watchdog tick failed:", err);
  }
}

let watchdogStarted = false;
function startWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  watchdogTick();
  const timer = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

// ─── Read endpoints ──────────────────────────────────────────────────

// Lets the frontend grey out / exclude classes that already have a live
// (non-reversed) promotion move for a given source year, so the admin
// finds out before configuring a whole run rather than after.
const getPromotedClasses = catchAsync(async (req, res, next) => {
  const { academic_year_from_id } = req.query;
  if (!academic_year_from_id) {
    return next(
      new AppError("academic_year_from_id is required", StatusCodes.BAD_REQUEST)
    );
  }

  const moves = await models.PromotionRunMove.findAll({
    where: { status: { [Op.ne]: "reversed" } },
    include: [
      {
        association: models.PromotionRunMove.associations.run,
        where: { academic_year_from_id },
        attributes: [],
        required: true,
      },
    ],
    attributes: ["id", "source_class_id", "status"],
  });

  appResponder(
    StatusCodes.OK,
    moves.map((m) => ({
      class_id: m.source_class_id,
      move_id: m.id,
      status: m.status,
    })),
    res
  );
});

const getRun = catchAsync(async (req, res, next) => {
  const run = await models.PromotionRun.findByPk(req.params.id, {
    include: [
      {
        association: models.PromotionRun.associations.moves,
        include: [
          { association: models.PromotionRunMove.associations.source_class },
          { association: models.PromotionRunMove.associations.destination_class },
        ],
      },
      { association: models.PromotionRun.associations.academic_year_from },
      { association: models.PromotionRun.associations.academic_year_to },
      { association: models.PromotionRun.associations.initiator },
    ],
  });
  if (!run) return next(new AppError("Run not found", 404));
  appResponder(StatusCodes.OK, run, res);
});

const listRuns = catchAsync(async (req, res) => {
  const runs = await models.PromotionRun.findAll({
    order: [["id", "DESC"]],
    limit: 100,
    include: [
      {
        association: models.PromotionRun.associations.moves,
        include: [
          { association: models.PromotionRunMove.associations.source_class },
          { association: models.PromotionRunMove.associations.destination_class },
        ],
      },
      { association: models.PromotionRun.associations.academic_year_from },
      { association: models.PromotionRun.associations.academic_year_to },
      { association: models.PromotionRun.associations.initiator },
    ],
  });
  appResponder(StatusCodes.OK, runs, res);
});

// ─── Move student detail (for viewing/overriding individual outcomes) ──

const getMoveStudents = catchAsync(async (req, res, next) => {
  const move = await models.PromotionRunMove.findByPk(req.params.moveId, {
    include: [
      { association: models.PromotionRunMove.associations.source_class },
      { association: models.PromotionRunMove.associations.destination_class },
    ],
  });
  if (!move || move.run_id !== Number(req.params.runId)) {
    return next(new AppError("Move not found", 404));
  }

  const rows = await models.StudentPromotion.findAll({
    where: { run_move_id: move.id },
    include: [
      {
        association: models.StudentPromotion.associations.student,
        attributes: ["id", "full_name", "student_id"],
      },
    ],
    order: [["id", "ASC"]],
  });

  // A student can have more than one row here if their outcome was later
  // manually overridden. Keep only the latest row per student for display,
  // but flag that it replaced an earlier decision.
  const latestByStudent = new Map();
  for (const row of rows) {
    const existing = latestByStudent.get(row.student_id);
    if (!existing || row.id > existing.id) {
      latestByStudent.set(row.student_id, row);
    }
  }

  const students = [...latestByStudent.values()].map((row) => ({
    id: row.id,
    student_id: row.student_id,
    name: row.student?.full_name,
    registration_number: row.student?.student_id,
    decision: row.decision,
    overall_average: row.overall_average,
    has_incomplete_data: row.has_incomplete_data,
    detail_snapshot: row.detail_snapshot,
    was_overridden: row.detail_snapshot?.manual_override === true,
  }));

  appResponder(
    StatusCodes.OK,
    {
      move: {
        id: move.id,
        source_class: move.source_class,
        destination_class: move.destination_class,
        is_graduation: move.is_graduation,
        status: move.status,
      },
      students,
    },
    res
  );
});

// ─── Manual override: repeating ("failed") student -> promoted on condition

const overrideStudentDecision = catchAsync(async (req, res, next) => {
  const { reason } = req.body || {};

  const original = await models.StudentPromotion.findByPk(
    req.params.studentPromotionId,
    {
      include: [{ association: models.StudentPromotion.associations.move }],
    }
  );
  if (
    !original ||
    original.run_move_id !== Number(req.params.moveId) ||
    original.run_id !== Number(req.params.runId)
  ) {
    return next(new AppError("Student promotion record not found", 404));
  }
  if (original.decision !== "failed") {
    return next(
      new AppError(
        "Only a failed (repeating) decision can be manually overridden to promoted on condition",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const move = original.move;
  const student = await models.Student.findByPk(original.student_id, {
    attributes: ["id", "class_id", "academic_year_id", "status"],
  });
  const stillAtOriginalOutcome =
    student &&
    student.class_id === original.to_class_id &&
    student.academic_year_id === original.to_academic_year_id;
  if (!stillAtOriginalOutcome) {
    return next(
      new AppError(
        "This student has since been moved again by a later action, so this outcome can no longer be overridden",
        StatusCodes.CONFLICT
      )
    );
  }

  const run = await models.PromotionRun.findByPk(original.run_id);
  const toClassId = move.is_graduation ? null : move.destination_class_id;
  const toAcademicYearId = move.is_graduation ? null : run.academic_year_to_id;
  const newStatus = move.is_graduation ? "graduated" : "active";

  const t = await models.PromotionRun.sequelize.transaction();
  let created;
  try {
    created = await models.StudentPromotion.create(
      {
        run_id: original.run_id,
        run_move_id: original.run_move_id,
        student_id: original.student_id,
        from_class_id: original.from_class_id,
        from_academic_year_id: original.from_academic_year_id,
        to_class_id: toClassId,
        to_academic_year_id: toAcademicYearId,
        decision: "promoted_on_condition",
        overall_average: original.overall_average,
        has_incomplete_data: original.has_incomplete_data,
        detail_snapshot: {
          ...original.detail_snapshot,
          manual_override: true,
          original_decision: "failed",
          overridden_by: req.user.id,
          overridden_at: new Date().toISOString(),
          override_reason: reason || null,
        },
      },
      { transaction: t }
    );

    await models.Student.update(
      {
        class_id: toClassId,
        academic_year_id: toAcademicYearId,
        status: newStatus,
      },
      { where: { id: original.student_id }, transaction: t }
    );

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  appResponder(StatusCodes.OK, created, res);
});

// ─── Reversal ────────────────────────────────────────────────────────

const reverseMove = catchAsync(async (req, res, next) => {
  const { confirmDespiteDownstreamMarks } = req.body || {};

  const move = await models.PromotionRunMove.findByPk(req.params.moveId, {
    include: [{ association: models.PromotionRunMove.associations.run }],
  });
  if (!move) return next(new AppError("Move not found", 404));
  if (move.status !== "completed") {
    return next(
      new AppError(
        `Only a completed move can be reversed (current status: ${move.status})`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const allRows = await models.StudentPromotion.findAll({
    where: { run_move_id: move.id },
    order: [["id", "ASC"]],
  });

  // A student can have more than one row for this move if their outcome
  // was later manually overridden (e.g. failed -> promoted on condition).
  // Reversal must only look at each student's current (latest) row, not
  // the superseded original, otherwise the stale-outcome check below
  // fires incorrectly against a decision that was already replaced within
  // this same move, and the restore step would double-process them.
  const latestByStudent = new Map();
  for (const row of allRows) {
    latestByStudent.set(row.student_id, row);
  }
  const decisions = [...latestByStudent.values()];

  // Guard: refuse if any affected student has since been moved again by a
  // later action, reversal is only ever "undo the last transition".
  const staleFor = [];
  for (const d of decisions) {
    const student = await models.Student.findByPk(d.student_id, {
      attributes: ["id", "class_id", "academic_year_id", "status"],
    });
    const stillAtTarget =
      student &&
      student.class_id === d.to_class_id &&
      student.academic_year_id === d.to_academic_year_id;
    if (!stillAtTarget) staleFor.push(d.student_id);
  }
  if (staleFor.length > 0) {
    return next(
      new AppError(
        `Cannot reverse, ${staleFor.length} student(s) have since been moved again by a later action. Reverse that action first.`,
        StatusCodes.CONFLICT
      )
    );
  }

  // Soft-warn if marks were entered in the destination class/year since.
  const targetStudentIds = decisions
    .filter((d) => d.to_class_id)
    .map((d) => d.student_id);
  let downstreamMarkCount = 0;
  if (targetStudentIds.length) {
    downstreamMarkCount = await models.Mark.count({
      where: {
        student_id: { [Op.in]: targetStudentIds },
        class_id: { [Op.in]: decisions.map((d) => d.to_class_id).filter(Boolean) },
        academic_year_id: move.run.academic_year_to_id,
      },
    });
  }
  if (downstreamMarkCount > 0 && !confirmDespiteDownstreamMarks) {
    return appResponder(
      StatusCodes.OK,
      {
        requiresConfirmation: true,
        message: `${downstreamMarkCount} mark(s) exist for these students in the class you're reverting from, they will remain but won't show on this student's current roster. Confirm to proceed anyway.`,
      },
      res
    );
  }

  const t = await models.PromotionRun.sequelize.transaction();
  try {
    for (const d of decisions) {
      await models.Student.update(
        {
          class_id: d.from_class_id,
          academic_year_id: d.from_academic_year_id,
          status: "active",
        },
        { where: { id: d.student_id }, transaction: t }
      );
    }
    await move.update(
      { status: "reversed", reversed_by: req.user.id, reversed_at: new Date() },
      { transaction: t }
    );
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  appResponder(StatusCodes.OK, { status: "reversed" }, res);
});

module.exports = {
  previewMove,
  startRun,
  getRun,
  listRuns,
  getPromotedClasses,
  getMoveStudents,
  overrideStudentDecision,
  reverseMove,
  startWatchdog,
};
