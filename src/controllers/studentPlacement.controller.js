"use strict";
// Registration-time placement ("Option A" of the year-switch discussion,
// 2026-09-17): the school switches to the new academic year BEFORE it knows
// where every student goes, then places returning students one by one as
// they come to register, and marks the ones who never come back as
// graduated or as having left.
//
// One rule underpins all of it: a student is "placed" when their
// academic_year_id moves to the active year. So "not yet placed" is not a
// flag anyone has to maintain, it is computed: status = active AND
// academic_year_id != the active year. That definition cannot drift, and it
// is what the switch checklist, the dashboard count, the Students page
// filter and the Academic Year page all read.
//
// Every placement is written as the SAME records a bulk promotion run
// writes (PromotionRun scope "manual" -> PromotionRunMove -> StudentPromotion),
// so Promotion History, reversal and the Academic Year page see it without
// special cases. Exits (graduated / left) outside a run are recorded in
// student_status_changes (StudentStatusChange.model.js) and are revertible.
//
// Murphy's-law guards, all server-side so no UI can bypass them:
//   - a student can only be placed once (409 with where they already are)
//   - only ACTIVE students from an OLDER year can be placed
//   - destination must exist, not be suspended; a different department
//     needs an explicit confirm_cross_department
//   - nothing runs while a bulk promotion run or a year switch is in
//     progress (same lock row the runs use)
//   - bulk exits carry an expected_count so a stale screen cannot exit
//     students the operator never saw
//   - every write is one transaction with the student row locked

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination.util");
const { getActiveYear } = require("../services/activeAcademicYear.service");
const { computeStudentAverages } = require("../utils/promotionMath");
const { decidePromotion } = require("../utils/promotionDecision.util");

const sequelize = models.AcademicYear.sequelize;
const BULK_EXIT_MAX = 500;
const EXIT_STATUSES = ["graduated", "withdrawn"];
const PLACEMENT_DECISIONS = ["promoted", "promoted_on_condition", "failed"];

// Same self-healing bootstrap as the other src/ modules.
async function initPlacementTables() {
  try {
    const existing = await sequelize.getQueryInterface().showAllTables();
    if (!existing.includes(models.StudentStatusChange.getTableName())) {
      await models.StudentStatusChange.sync({ force: false });
    }
  } catch (err) {
    console.error("[Placement] Failed to initialize tables:", err.message);
  }
}
initPlacementTables();

// ─── Shared helpers ──────────────────────────────────────────────────────

async function requireActiveYear() {
  const active = await getActiveYear({ bypassCache: true });
  if (!active) throw new AppError("No active academic year.", StatusCodes.CONFLICT);
  return active;
}

// Placement and exits move students between years; a bulk run or a year
// switch doing the same at the same time would race it.
async function assertNoRunOrSwitchInProgress() {
  const lock = await models.PromotionRunLock.findByPk(1);
  if (lock && lock.current_run_id) {
    throw new AppError(
      "A promotion run is in progress. Wait for it to finish before placing students individually.",
      StatusCodes.CONFLICT
    );
  }
  if (lock && lock.year_switch_in_progress) {
    throw new AppError("An academic year switch is in progress. Try again in a moment.", StatusCodes.CONFLICT);
  }
}

const pendingWhere = (activeYearId, extra = {}) => ({
  status: "active",
  academic_year_id: { [Op.ne]: activeYearId },
  ...extra,
});

function placementStateOf(student, activeYearId) {
  if (student.status !== "active") return student.status; // "graduated" | "withdrawn"
  return Number(student.academic_year_id) === Number(activeYearId) ? "placed" : "pending";
}

// What the registration clerk needs to decide: last class, the average
// and the decision, computed exactly the way a bulk run computes it (same
// promotionMath / promotionDecision helpers), or taken from the run that
// already judged this student if one did.
async function evaluateStudent(student) {
  const yearId = student.academic_year_id;
  const classId = student.class_id;
  if (!yearId || !classId) return { source: "none", annual_average: null, decision: null, reasons: [], has_incomplete_data: true };

  const recorded = await models.StudentPromotion.findOne({
    where: { student_id: student.id, from_academic_year_id: yearId, from_class_id: classId },
    order: [["id", "DESC"]],
  });
  if (recorded) {
    return {
      source: "promotion_run",
      run_id: recorded.run_id,
      annual_average: recorded.overall_average,
      decision: recorded.decision,
      reasons: recorded.detail_snapshot?.reasons || [],
      has_incomplete_data: !!recorded.has_incomplete_data,
    };
  }

  // Same inputs the bulk run builds (promotion.controller.js
  // buildSubjectMeta / fetchMarksByStudent): a Map of subject meta keyed
  // by subject id, and marks as { subject_id, score, sequence_order }.
  const [classSubjectRows, markRows, requirementRow] = await Promise.all([
    models.ClassSubject.findAll({
      where: { class_id: classId, academic_year_id: yearId },
      include: [{ association: models.ClassSubject.associations.subject, attributes: ["id", "name", "category", "coefficient"] }],
      attributes: [],
      raw: true,
      nest: true,
    }),
    models.Mark.findAll({
      where: { student_id: student.id, class_id: classId, academic_year_id: yearId },
      include: [{ association: models.Mark.associations.sequence, attributes: ["order_number"] }],
      attributes: ["subject_id", "score"],
      raw: true,
      nest: true,
    }),
    models.PromotionRequirement.findOne({ where: { academic_year_id: yearId, class_id: classId } }),
  ]);
  if (!markRows.length) {
    return { source: "none", annual_average: null, decision: null, reasons: ["No marks recorded for this student in that year."], has_incomplete_data: true };
  }
  const subjectMeta = new Map();
  for (const row of classSubjectRows) {
    const sub = row.subject;
    if (sub && sub.id && !subjectMeta.has(sub.id)) {
      subjectMeta.set(sub.id, { category: sub.category, coefficient: sub.coefficient, name: sub.name });
    }
  }
  const marks = markRows.map((r) => ({ subject_id: r.subject_id, score: r.score, sequence_order: r.sequence?.order_number }));
  const { subjectAverages, annualAverage, hasIncompleteData, gaps } = computeStudentAverages(marks, subjectMeta);
  if (!requirementRow) {
    return { source: "marks_only", annual_average: annualAverage, decision: null, reasons: ["No promotion requirement is set for this class, decide manually."], has_incomplete_data: hasIncompleteData, gaps };
  }
  const { decision, reasons } = decidePromotion(annualAverage, subjectAverages, requirementRow.get({ plain: true }));
  return { source: "rules", annual_average: annualAverage, decision, reasons, has_incomplete_data: hasIncompleteData, gaps };
}

async function departmentClassesFor(classRow) {
  if (!classRow) return [];
  return models.Class.findAll({
    where: { department_id: classRow.department_id, suspended: false },
    attributes: ["id", "name", "department_id", "is_orientation"],
    order: [["name", "ASC"]],
    raw: true,
  });
}

const studentIncludes = () => [
  { association: models.Student.associations.Class, attributes: ["id", "name", "department_id", "suspended"] },
];

function plainStudent(s, activeYearId, yearName) {
  const p = s.get ? s.get({ plain: true }) : s;
  return {
    id: p.id,
    student_id: p.student_id,
    full_name: p.full_name,
    sex: p.sex,
    status: p.status,
    is_repeating: p.is_repeating,
    academic_year_id: p.academic_year_id,
    academic_year_name: yearName || null,
    class_id: p.class_id,
    class_name: p.Class?.name || null,
    department_id: p.Class?.department_id || null,
    placement_state: placementStateOf(p, activeYearId),
  };
}

// ─── GET /students/pending-placement ─────────────────────────────────────
//
// Everyone still active in an older year, with per-class counts, so the
// dashboard, the Students page filter and the year page all read one list.
const listPendingPlacement = catchAsync(async (req, res) => {
  const active = await requireActiveYear();
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
  const where = pendingWhere(active.id);
  if (req.query.class_id) where.class_id = req.query.class_id;
  if (req.query.academic_year_id) where.academic_year_id = { [Op.ne]: active.id, [Op.eq]: req.query.academic_year_id };
  const search = String(req.query.search || "").trim();
  if (search) {
    where[Op.or] = [{ full_name: { [Op.iLike]: `%${search}%` } }, { student_id: { [Op.iLike]: `%${search}%` } }];
  }

  const [{ rows, count }, perClass, years] = await Promise.all([
    models.Student.findAndCountAll({
      where,
      include: studentIncludes(),
      order: [["full_name", "ASC"]],
      limit,
      offset,
    }),
    sequelize.query(
      `SELECT s.class_id, c.name AS class_name, s.academic_year_id, COUNT(*)::int AS students
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.status = 'active' AND s.academic_year_id <> :activeId AND s."deletedAt" IS NULL
       GROUP BY s.class_id, c.name, s.academic_year_id ORDER BY c.name`,
      { replacements: { activeId: active.id }, type: sequelize.QueryTypes.SELECT }
    ),
    models.AcademicYear.findAll({ attributes: ["id", "name"], raw: true }),
  ]);
  const yearName = new Map(years.map((y) => [y.id, y.name]));

  appResponder(
    StatusCodes.OK,
    {
      active_year: { id: active.id, name: active.name },
      total_pending: perClass.reduce((n, r) => n + r.students, 0),
      classes: perClass.map((r) => ({ ...r, academic_year_name: yearName.get(r.academic_year_id) || null })),
      students: rows.map((s) => plainStudent(s, active.id, yearName.get(s.academic_year_id))),
      pagination: buildPaginationMeta(page, limit, count),
    },
    res
  );
});

// ─── GET /students/returning?search= ─────────────────────────────────────
//
// The registration desk's first step: find the student across every year
// before creating anyone, so a returning student is never registered twice.
// Each match says what can happen next (placement_state) and, for pending
// ones, everything needed to place them.
const lookupReturning = catchAsync(async (req, res, next) => {
  const search = String(req.query.search || "").trim();
  if (search.length < 2) {
    return next(new AppError("search must be at least 2 characters.", StatusCodes.BAD_REQUEST));
  }
  const active = await requireActiveYear();
  const matches = await models.Student.findAll({
    where: { [Op.or]: [{ full_name: { [Op.iLike]: `%${search}%` } }, { student_id: { [Op.iLike]: `%${search}%` } }] },
    include: studentIncludes(),
    order: [["full_name", "ASC"]],
    limit: 20,
  });
  const years = await models.AcademicYear.findAll({ attributes: ["id", "name"], raw: true });
  const yearName = new Map(years.map((y) => [y.id, y.name]));

  const results = [];
  for (const s of matches) {
    const base = plainStudent(s, active.id, yearName.get(s.academic_year_id));
    if (base.placement_state === "pending") {
      const [evaluation, departmentClasses] = await Promise.all([evaluateStudent(s), departmentClassesFor(s.Class)]);
      // Same class if the rules say repeat; otherwise the clerk chooses (the
      // school has no "next class" ordering, so nothing is guessed).
      const suggested = evaluation.decision === "failed" ? s.class_id : null;
      results.push({ ...base, evaluation, department_classes: departmentClasses, suggested_class_id: suggested });
    } else {
      results.push(base);
    }
  }
  appResponder(StatusCodes.OK, { active_year: { id: active.id, name: active.name }, results }, res);
});

// ─── POST /students/:id/place ────────────────────────────────────────────
//
// body: { destination_class_id, decision?, confirm_cross_department?, reason? }
// decision defaults from the destination: same class -> "failed" (repeat),
// another class -> "promoted". A different department is refused unless
// confirm_cross_department is true, the same rule the bulk run applies.
const placeStudent = catchAsync(async (req, res, next) => {
  const studentId = Number(req.params.id);
  const { destination_class_id, decision: decisionInput, confirm_cross_department, reason } = req.body || {};
  const destinationId = Number(destination_class_id);
  if (!Number.isInteger(destinationId) || destinationId <= 0) {
    return next(new AppError("destination_class_id is required.", StatusCodes.BAD_REQUEST));
  }
  if (decisionInput !== undefined && decisionInput !== null && !PLACEMENT_DECISIONS.includes(decisionInput)) {
    return next(new AppError(`decision must be one of ${PLACEMENT_DECISIONS.join(", ")}.`, StatusCodes.BAD_REQUEST));
  }

  const active = await requireActiveYear();
  await assertNoRunOrSwitchInProgress();

  const result = await sequelize.transaction(async (t) => {
    const student = await models.Student.findByPk(studentId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!student) throw new AppError("Student not found.", StatusCodes.NOT_FOUND);
    if (student.status !== "active") {
      throw new AppError(`This student is marked ${student.status} and cannot be placed. Revert that first.`, StatusCodes.CONFLICT);
    }
    if (Number(student.academic_year_id) === Number(active.id)) {
      const current = student.class_id ? await models.Class.findByPk(student.class_id, { transaction: t }) : null;
      throw new AppError(
        `This student is already placed in ${active.name}${current ? ` (${current.name})` : ""}. Use the student's page to move them.`,
        StatusCodes.CONFLICT
      );
    }

    const [source, destination] = await Promise.all([
      student.class_id ? models.Class.findByPk(student.class_id, { transaction: t }) : null,
      models.Class.findByPk(destinationId, { transaction: t }),
    ]);
    if (!destination) throw new AppError("Destination class not found.", StatusCodes.NOT_FOUND);
    if (destination.suspended) throw new AppError("Destination class is suspended.", StatusCodes.BAD_REQUEST);
    if (source && Number(source.department_id) !== Number(destination.department_id) && confirm_cross_department !== true) {
      throw new AppError(
        "Destination is in a different department from the student's previous class. Resend with confirm_cross_department: true if this is intended.",
        StatusCodes.CONFLICT
      );
    }

    const isSameClass = source && Number(source.id) === destinationId;
    const decision = decisionInput || (isSameClass ? "failed" : "promoted");
    const evaluation = await evaluateStudent(student);
    const now = new Date();

    const run = await models.PromotionRun.create(
      {
        scope: "manual",
        academic_year_from_id: student.academic_year_id,
        academic_year_to_id: active.id,
        status: "completed",
        initiated_by: req.user.id,
        initiated_at: now,
        completed_at: now,
        interruption_count: 0,
      },
      { transaction: t }
    );
    const move = await models.PromotionRunMove.create(
      {
        run_id: run.id,
        source_class_id: student.class_id,
        destination_class_id: destinationId,
        is_graduation: false,
        // What the clerk saw when deciding, the closest thing a single
        // placement has to a run's requirement snapshot.
        requirement_snapshot: {
          placed_at_registration: true,
          evaluation_source: evaluation.source,
          annual_average: evaluation.annual_average,
          suggested_decision: evaluation.decision,
          reasons: evaluation.reasons || [],
        },
        manual_decisions: { [student.id]: decision },
        destination_overrides: null,
        status: "completed",
        total_students: 1,
        processed_students: 1,
        cursor_student_id: student.id,
        started_at: now,
        completed_at: now,
      },
      { transaction: t }
    );
    await models.StudentPromotion.create(
      {
        run_id: run.id,
        run_move_id: move.id,
        student_id: student.id,
        from_class_id: student.class_id,
        from_academic_year_id: student.academic_year_id,
        to_class_id: destinationId,
        to_academic_year_id: active.id,
        decision,
        overall_average: evaluation.annual_average,
        has_incomplete_data: !!evaluation.has_incomplete_data,
        was_repeating: !!student.is_repeating,
        detail_snapshot: {
          placed_at_registration: true,
          reasons: evaluation.reasons || [],
          gaps: evaluation.gaps || [],
          evaluation_source: evaluation.source,
          manual_decision: decisionInput || null,
          reason: reason || null,
          cross_department: !!(source && Number(source.department_id) !== Number(destination.department_id)),
        },
      },
      { transaction: t }
    );
    // Same write a bulk run does; the student's old year is archived, so
    // the year-lock hook is skipped exactly like the run skips it.
    await models.Student.update(
      { class_id: destinationId, academic_year_id: active.id, is_repeating: !!isSameClass },
      { where: { id: student.id }, transaction: t, skipYearLockCheck: true }
    );
    return { run_id: run.id, move_id: move.id, decision, destination: destination.get({ plain: true }), source: source ? source.get({ plain: true }) : null };
  });

  const placed = await models.Student.findByPk(studentId, { include: studentIncludes() });
  appResponder(
    StatusCodes.OK,
    {
      student: plainStudent(placed, active.id, active.name),
      placement: result,
      message: `${placed.full_name} placed in ${result.destination.name} for ${active.name}${result.decision === "failed" ? " (repeating)" : ""}.`,
    },
    res
  );
});

// ─── Exits: graduated / left ─────────────────────────────────────────────

async function exitStudents({ studentIds, toStatus, reason, effectiveDate, source, user }) {
  return sequelize.transaction(async (t) => {
    const students = await models.Student.findAll({
      where: { id: { [Op.in]: studentIds } },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const found = new Set(students.map((s) => s.id));
    const missing = studentIds.filter((id) => !found.has(id));
    if (missing.length) throw new AppError(`Student id(s) not found: ${missing.join(", ")}`, StatusCodes.NOT_FOUND);
    const notActive = students.filter((s) => s.status !== "active");
    if (notActive.length) {
      throw new AppError(
        `Only active students can be marked ${toStatus}. Already inactive: ${notActive.map((s) => s.full_name).join(", ")}`,
        StatusCodes.CONFLICT
      );
    }
    const now = new Date();
    await models.StudentStatusChange.bulkCreate(
      students.map((s) => ({
        student_id: s.id,
        from_status: s.status,
        to_status: toStatus,
        academic_year_id: s.academic_year_id,
        class_id: s.class_id,
        reason: reason || null,
        effective_date: effectiveDate || null,
        source,
        performed_by: user.id,
        performed_at: now,
      })),
      { transaction: t }
    );
    await models.Student.update(
      { status: toStatus },
      { where: { id: { [Op.in]: studentIds } }, transaction: t, skipYearLockCheck: true }
    );
    return students.map((s) => ({ id: s.id, full_name: s.full_name, from_status: s.status, to_status: toStatus }));
  });
}

function parseExitBody(body, next) {
  const { status, reason, effective_date } = body || {};
  if (!EXIT_STATUSES.includes(status)) {
    next(new AppError(`status must be one of ${EXIT_STATUSES.join(", ")}.`, StatusCodes.BAD_REQUEST));
    return null;
  }
  if (effective_date && Number.isNaN(new Date(effective_date).getTime())) {
    next(new AppError("effective_date is not a valid date.", StatusCodes.BAD_REQUEST));
    return null;
  }
  return { status, reason: reason ? String(reason).trim() : null, effective_date: effective_date || null };
}

// POST /students/:id/exit  { status: "graduated"|"withdrawn", reason?, effective_date? }
const exitStudent = catchAsync(async (req, res, next) => {
  const parsed = parseExitBody(req.body, next);
  if (!parsed) return undefined;
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) return next(new AppError("Invalid student id.", StatusCodes.BAD_REQUEST));
  await assertNoRunOrSwitchInProgress();
  const [changed] = await exitStudents({
    studentIds: [studentId],
    toStatus: parsed.status,
    reason: parsed.reason,
    effectiveDate: parsed.effective_date,
    source: "single",
    user: req.user,
  });
  return appResponder(StatusCodes.OK, { ...changed, message: `${changed.full_name} marked as ${parsed.status === "graduated" ? "graduated" : "left the school"}.` }, res);
});

// POST /students/bulk-exit
// { student_ids: [...], status, reason?, effective_date?, expected_count? }
// expected_count is what the operator's screen showed; if the list has
// changed since (someone placed or exited a student meanwhile), refuse and
// let them look again rather than exiting people they never reviewed.
const bulkExit = catchAsync(async (req, res, next) => {
  const parsed = parseExitBody(req.body, next);
  if (!parsed) return undefined;
  const ids = Array.isArray(req.body.student_ids) ? [...new Set(req.body.student_ids.map(Number))] : [];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return next(new AppError("student_ids must be a non-empty list of student ids.", StatusCodes.BAD_REQUEST));
  }
  if (ids.length > BULK_EXIT_MAX) {
    return next(new AppError(`At most ${BULK_EXIT_MAX} students per request.`, StatusCodes.BAD_REQUEST));
  }
  if (req.body.expected_count !== undefined && Number(req.body.expected_count) !== ids.length) {
    return next(
      new AppError(`expected_count (${req.body.expected_count}) does not match the ${ids.length} students sent. Reload the list and try again.`, StatusCodes.CONFLICT)
    );
  }
  await assertNoRunOrSwitchInProgress();
  const changed = await exitStudents({
    studentIds: ids,
    toStatus: parsed.status,
    reason: parsed.reason,
    effectiveDate: parsed.effective_date,
    source: "bulk",
    user: req.user,
  });
  return appResponder(StatusCodes.OK, { count: changed.length, students: changed, message: `${changed.length} student(s) marked as ${parsed.status}.` }, res);
});

// POST /students/pending-placement/exit-all
// { from_academic_year_id, status, reason?, expected_count }
// "Everyone still not placed from <year>": the sweep at the end of
// registration. expected_count is REQUIRED here because the list is
// implicit; it must equal the live count or nothing happens. The field is
// deliberately NOT called academic_year_id: the generic archived-year lock
// reads that name from any request body and would refuse this as an edit
// to the old year, while what changes here is the students' status, which
// is an active-year registration action.
const exitAllPending = catchAsync(async (req, res, next) => {
  const parsed = parseExitBody(req.body, next);
  if (!parsed) return undefined;
  const yearId = Number(req.body.from_academic_year_id);
  if (!Number.isInteger(yearId) || yearId <= 0) return next(new AppError("from_academic_year_id is required.", StatusCodes.BAD_REQUEST));
  if (req.body.expected_count === undefined) return next(new AppError("expected_count is required.", StatusCodes.BAD_REQUEST));
  const active = await requireActiveYear();
  if (yearId === active.id) return next(new AppError("That is the active year; only older years have pending students.", StatusCodes.BAD_REQUEST));
  await assertNoRunOrSwitchInProgress();

  const pending = await models.Student.findAll({ where: pendingWhere(active.id, { academic_year_id: yearId }), attributes: ["id"], raw: true });
  if (pending.length !== Number(req.body.expected_count)) {
    return next(
      new AppError(`${pending.length} students are pending now, not ${req.body.expected_count}. Reload the list and confirm again.`, StatusCodes.CONFLICT)
    );
  }
  if (!pending.length) return appResponder(StatusCodes.OK, { count: 0, students: [], message: "Nobody is pending for that year." }, res);
  if (pending.length > BULK_EXIT_MAX) {
    return next(new AppError(`${pending.length} students pending; exit them class by class (max ${BULK_EXIT_MAX} per request).`, StatusCodes.BAD_REQUEST));
  }
  const changed = await exitStudents({
    studentIds: pending.map((p) => p.id),
    toStatus: parsed.status,
    reason: parsed.reason,
    effectiveDate: parsed.effective_date,
    source: "bulk",
    user: req.user,
  });
  return appResponder(StatusCodes.OK, { count: changed.length, students: changed, message: `${changed.length} student(s) marked as ${parsed.status}.` }, res);
});

// POST /students/:id/exit/revert
// Puts a graduated/left student back to active, only if that exit was the
// last thing that happened to them (recorded here and not already reverted).
const revertExit = catchAsync(async (req, res, next) => {
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) return next(new AppError("Invalid student id.", StatusCodes.BAD_REQUEST));
  await assertNoRunOrSwitchInProgress();
  const result = await sequelize.transaction(async (t) => {
    const student = await models.Student.findByPk(studentId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!student) throw new AppError("Student not found.", StatusCodes.NOT_FOUND);
    if (student.status === "active") throw new AppError("This student is already active.", StatusCodes.CONFLICT);
    const change = await models.StudentStatusChange.findOne({
      where: { student_id: studentId, to_status: student.status, reverted_at: null },
      order: [["performed_at", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!change) {
      throw new AppError(
        `This student's ${student.status} status was not set from the registration desk (it came from a promotion run or an edit), so it cannot be reverted here.`,
        StatusCodes.CONFLICT
      );
    }
    const now = new Date();
    await change.update({ reverted_at: now, reverted_by: req.user.id }, { transaction: t });
    await models.StudentStatusChange.create(
      {
        student_id: studentId,
        from_status: student.status,
        to_status: "active",
        academic_year_id: student.academic_year_id,
        class_id: student.class_id,
        reason: req.body?.reason ? String(req.body.reason).trim() : `Reverted ${student.status}`,
        source: "single",
        performed_by: req.user.id,
        performed_at: now,
      },
      { transaction: t }
    );
    await models.Student.update({ status: "active" }, { where: { id: studentId }, transaction: t, skipYearLockCheck: true });
    return { id: studentId, full_name: student.full_name, from_status: student.status, to_status: "active" };
  });
  return appResponder(StatusCodes.OK, { ...result, message: `${result.full_name} is active again.` }, res);
});

// GET /students/:id/status-history
const getStatusHistory = catchAsync(async (req, res, next) => {
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) return next(new AppError("Invalid student id.", StatusCodes.BAD_REQUEST));
  const rows = await models.StudentStatusChange.findAll({
    where: { student_id: studentId },
    order: [["performed_at", "DESC"]],
    include: [
      { association: models.StudentStatusChange.associations.class, attributes: ["id", "name"] },
      { association: models.StudentStatusChange.associations.academic_year, attributes: ["id", "name"] },
      { association: models.StudentStatusChange.associations.performer, attributes: ["id", "name", "username"] },
      { association: models.StudentStatusChange.associations.reverter, attributes: ["id", "name", "username"] },
    ],
  });
  return appResponder(StatusCodes.OK, rows, res);
});

module.exports = {
  listPendingPlacement,
  lookupReturning,
  placeStudent,
  exitStudent,
  bulkExit,
  exitAllPending,
  revertExit,
  getStatusHistory,
  pendingWhere,
};
