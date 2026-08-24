"use strict";

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const fs = require("fs");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");
const { generateClassReportCardsToFile } = require("../utils/reportCardChunkedGenerator.util");
const { uploadSingleFileToFTP } = require("../services/fileStorage.service");
const { notify } = require("../utils/academicJobNotification.util");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination.util");

// Same self-healing bootstrap pattern as every other module in src/, these
// tables are brand new so force:false-sync is enough, no migration needed.
async function initReportCardTables() {
  const targets = [
    models.ReportCardSession,
    models.ReportCardRun,
    models.ReportCardRunLock,
    models.AcademicJobNotification,
  ];
  try {
    const existingTables = await models.ReportCardSession.sequelize
      .getQueryInterface()
      .showAllTables();
    for (const model of targets) {
      if (!existingTables.includes(model.getTableName())) {
        await model.sync({ force: false });
      }
    }
  } catch (err) {
    console.error("[ReportCards] Failed to initialize report card tables:", err.message);
  }
}
initReportCardTables();

// ─── Mutex ────────────────────────────────────────────────────────────
// Not about correctness, generation never mutates student data, purely
// about not letting two large jobs compete for the VPS's memory budget
// at the same time.

async function acquireSessionLock(sessionId) {
  const [row] = await models.ReportCardRunLock.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, current_session_id: null },
  });
  if (process.env.REPORT_CARD_DEBUG_LOCK === "1") {
    console.log(`[lock] acquire(${sessionId}) sees row:`, JSON.stringify(row.get({ plain: true })));
  }
  const [updatedCount] = await models.ReportCardRunLock.update(
    { current_session_id: sessionId, locked_at: new Date() },
    { where: { id: 1, current_session_id: null } }
  );
  if (process.env.REPORT_CARD_DEBUG_LOCK === "1") {
    console.log(`[lock] acquire(${sessionId}) updatedCount=${updatedCount}`);
  }
  return updatedCount === 1;
}

async function releaseSessionLock(sessionId) {
  await models.ReportCardRunLock.update(
    { current_session_id: null },
    { where: { id: 1, current_session_id: sessionId } }
  );
}

// Generation itself has no internal timeout (unlike uploadSingleFileToFTP,
// which now watchdogs its own stalled connections, see fileStorage.service.js).
// A pathological class (a hanging query, a stuck worker) must not be able to
// leave a run stuck "running" forever the way a stalled FTP upload used to —
// same "never await a network/IO op unbounded" principle as the desktop
// sync handler's batch-ack timeout.
const RUN_GENERATION_TIMEOUT_MS =
  Number(process.env.REPORT_CARD_GENERATION_TIMEOUT_MS) || 8 * 60 * 1000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─── Start a session ─────────────────────────────────────────────────

const startSession = catchAsync(async (req, res, next) => {
  const { academic_year_id, term = "term3", class_ids } = req.body;

  if (!academic_year_id) {
    return next(new AppError("academic_year_id is required", StatusCodes.BAD_REQUEST));
  }
  if (!Array.isArray(class_ids) || class_ids.length === 0) {
    return next(new AppError("At least one class_id is required", StatusCodes.BAD_REQUEST));
  }

  const classes = await models.Class.findAll({ where: { id: { [Op.in]: class_ids } } });
  if (classes.length !== class_ids.length) {
    return next(new AppError("One or more classes were not found", StatusCodes.NOT_FOUND));
  }

  const session = await models.ReportCardSession.create({
    academic_year_id,
    term,
    status: "pending",
    initiated_by: req.user.id,
    total_classes: class_ids.length,
  });

  const acquired = await acquireSessionLock(session.id);
  if (!acquired) {
    await session.destroy();
    return next(
      new AppError(
        "A report card generation session is already in progress. Only one may run at a time.",
        StatusCodes.CONFLICT
      )
    );
  }

  const runs = await models.ReportCardRun.bulkCreate(
    class_ids.map((classId) => ({ session_id: session.id, class_id: classId, status: "pending" })),
    { returning: true }
  );

  appResponder(
    StatusCodes.ACCEPTED,
    { session_id: session.id, status: "pending", runs: runs.map((r) => r.id) },
    res
  );

  runSessionExecutor(session.id).catch((err) => {
    console.error(`[ReportCards] Session ${session.id} executor crashed:`, err);
  });
});

// ─── Executor ────────────────────────────────────────────────────────
// Classes are processed strictly one at a time, sequentially, so a
// whole-school session costs no more peak memory than a single-class one,
// it only takes longer, which matches "start it in the morning, come
// back later." One class failing (bad data, an upload hiccup) doesn't
// stop the rest, unlike a promotion run which fails as a whole because
// it mutates shared state, report card generation is read-only.

async function runSessionExecutor(sessionId) {
  const session = await models.ReportCardSession.findByPk(sessionId);
  if (!session) return;
  await session.update({ status: "running", started_at: new Date() });

  const runs = await models.ReportCardRun.findAll({
    where: { session_id: sessionId, status: "pending" },
    order: [["id", "ASC"]],
    include: [{ association: models.ReportCardRun.associations.class }],
  });

  let completed = 0;
  let failed = 0;

  try {
    for (const run of runs) {
      const className = run.class?.name || `class ${run.class_id}`;
      await run.update({ status: "running", started_at: new Date() });

      try {
        const { filePath, totalStudents } = await withTimeout(
          generateClassReportCardsToFile(
            session.academic_year_id,
            run.class_id,
            session.term,
            (processed, total) => {
              run.update({ processed_students: processed, total_students: total }).catch(() => {});
            }
          ),
          RUN_GENERATION_TIMEOUT_MS,
          `Report card generation for ${className}`
        );

        const remoteFileName = `report-cards/session-${session.id}-class-${run.class_id}-${Date.now()}.pdf`;
        let fileUrl;
        try {
          fileUrl = await uploadSingleFileToFTP(filePath, remoteFileName, {});
        } finally {
          fs.unlink(filePath, () => {});
        }

        await run.update({
          status: "completed",
          file_url: fileUrl,
          total_students: totalStudents,
          processed_students: totalStudents,
          completed_at: new Date(),
        });
        completed += 1;

        await notify({
          role: "Admin3",
          type: "report_card_run_completed",
          title: `Report cards for ${className} are ready`,
          message: `${totalStudents} student(s) processed.`,
          deepLink: `/academics/report-cards/sessions/${session.id}`,
        });
      } catch (err) {
        console.error(`[ReportCards] Run ${run.id} (class ${run.class_id}) failed:`, err);
        await run.update({ status: "failed", error_message: err.message, completed_at: new Date() });
        failed += 1;

        await notify({
          role: "Admin3",
          type: "report_card_run_failed",
          title: `Report cards for ${className} failed`,
          message: err.message,
          deepLink: `/academics/report-cards/sessions/${session.id}`,
        });
      }

      await session.update({ completed_classes: completed, failed_classes: failed });
    }

    const sessionFailed = failed > 0 && completed === 0;
    await session.update({
      status: sessionFailed ? "failed" : "completed",
      completed_at: new Date(),
    });

    await notify({
      role: "Admin3",
      type: sessionFailed ? "report_card_session_failed" : "report_card_session_completed",
      title: sessionFailed ? "Report card generation session failed" : "Report card generation session complete",
      message: `${completed} class(es) done${failed ? `, ${failed} failed` : ""}.`,
      deepLink: `/academics/report-cards/sessions/${session.id}`,
    });
  } catch (err) {
    console.error(`[ReportCards] Session ${sessionId} failed:`, err);
    await session.update({ status: "failed", completed_at: new Date() });
    await notify({
      role: "Admin3",
      type: "report_card_session_failed",
      title: "Report card generation session failed",
      message: err.message,
      deepLink: `/academics/report-cards/sessions/${session.id}`,
    });
  } finally {
    await releaseSessionLock(sessionId);
  }
}

// ─── Watchdog ────────────────────────────────────────────────────────
//
// Same shape as promotion.controller.js's watchdog: covers both a process
// restart mid-session (the in-memory runSessionExecutor call is just gone,
// nothing left to ever move the row out of 'pending'/'running') and a
// genuinely hung run (a stalled FTP connection used to be the reliable way
// to trigger this before uploadSingleFileToFTP grew its own watchdog).
// Report card generation has no resumable cursor the way promotion moves
// do, so recovery here is "fail cleanly and notify", never "resume" — a
// resumed run would just regenerate the whole class from scratch anyway,
// no work is actually saved by trying.

const SESSION_STALL_TIMEOUT_MS =
  Number(process.env.REPORT_CARD_SESSION_STALL_TIMEOUT_MS) || 15 * 60 * 1000;
const REPORT_CARD_WATCHDOG_INTERVAL_MS = 60 * 1000;

async function reportCardWatchdogTick() {
  try {
    const staleBefore = new Date(Date.now() - SESSION_STALL_TIMEOUT_MS);
    const staleSessions = await models.ReportCardSession.findAll({
      where: {
        status: { [Op.in]: ["pending", "running"] },
        updated_at: { [Op.lt]: staleBefore },
      },
    });

    for (const session of staleSessions) {
      console.warn(
        `[ReportCards] Session ${session.id} appears stalled or orphaned by a restart (no progress since ${session.updated_at.toISOString()}), marking failed.`
      );

      await models.ReportCardRun.update(
        {
          status: "failed",
          error_message: "Interrupted — the server restarted or this run stalled past its timeout.",
          completed_at: new Date(),
        },
        { where: { session_id: session.id, status: { [Op.in]: ["pending", "running"] } } }
      );

      await session.update({ status: "failed", completed_at: new Date() });
      await releaseSessionLock(session.id);

      await notify({
        role: "Admin3",
        type: "report_card_session_failed",
        title: "Report card generation session failed",
        message: "The session was interrupted (server restart or a stalled run) and could not finish.",
        deepLink: `/academics/report-cards/sessions/${session.id}`,
      });
    }
  } catch (err) {
    console.error("[ReportCards] Watchdog tick failed:", err);
  }
}

let reportCardWatchdogStarted = false;
function startReportCardWatchdog() {
  if (reportCardWatchdogStarted) return;
  reportCardWatchdogStarted = true;
  reportCardWatchdogTick();
  const timer = setInterval(reportCardWatchdogTick, REPORT_CARD_WATCHDOG_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

// ─── Read endpoints ──────────────────────────────────────────────────

const getSession = catchAsync(async (req, res, next) => {
  const session = await models.ReportCardSession.findByPk(req.params.id, {
    include: [
      {
        association: models.ReportCardSession.associations.runs,
        include: [{ association: models.ReportCardRun.associations.class }],
      },
      { association: models.ReportCardSession.associations.academic_year },
      { association: models.ReportCardSession.associations.initiator },
    ],
  });
  if (!session) return next(new AppError("Session not found", StatusCodes.NOT_FOUND));
  appResponder(StatusCodes.OK, session, res);
});

// Whitelisted so req.query.sortBy can never become a raw SQL column
// injection vector — only these keys are accepted.
const SESSION_SORT_FIELDS = {
  id: "id",
  created_at: "created_at",
  status: "status",
  term: "term",
  total_classes: "total_classes",
};

const listSessions = catchAsync(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 100 });
  const { search = "", status } = req.query;
  const sortBy = SESSION_SORT_FIELDS[req.query.sortBy] || "id";
  const sortDir = String(req.query.sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

  const where = {};
  if (status) where.status = status;

  const trimmedSearch = String(search || "").trim();
  if (trimmedSearch) {
    // A session has no name of its own, admins actually search by the
    // class(es) it covered — so resolve matching class names to session
    // ids first (kept as a separate query rather than a where on the
    // nested `runs` include, which would corrupt limit/offset pagination
    // against a hasMany join), then OR that into the top-level where.
    const matchingClasses = await models.Class.findAll({
      where: { name: { [Op.iLike]: `%${trimmedSearch}%` } },
      attributes: ["id"],
      raw: true,
    });
    let sessionIdsFromClasses = [];
    if (matchingClasses.length) {
      const matchingRuns = await models.ReportCardRun.findAll({
        where: { class_id: { [Op.in]: matchingClasses.map((c) => c.id) } },
        attributes: ["session_id"],
        raw: true,
      });
      sessionIdsFromClasses = [...new Set(matchingRuns.map((r) => r.session_id))];
    }

    const orConditions = [
      { term: { [Op.iLike]: `%${trimmedSearch}%` } },
      { status: { [Op.iLike]: `%${trimmedSearch}%` } },
    ];
    if (/^\d+$/.test(trimmedSearch)) orConditions.push({ id: Number(trimmedSearch) });
    if (sessionIdsFromClasses.length) orConditions.push({ id: { [Op.in]: sessionIdsFromClasses } });
    where[Op.or] = orConditions;
  }

  const { rows, count } = await models.ReportCardSession.findAndCountAll({
    where,
    order: [[sortBy, sortDir]],
    limit,
    offset,
    distinct: true,
    include: [
      {
        association: models.ReportCardSession.associations.runs,
        include: [{ association: models.ReportCardRun.associations.class }],
      },
      { association: models.ReportCardSession.associations.academic_year },
      { association: models.ReportCardSession.associations.initiator },
    ],
  });

  appResponder(
    StatusCodes.OK,
    { sessions: rows, pagination: buildPaginationMeta(page, limit, count) },
    res
  );
});

module.exports = {
  initReportCardTables,
  startSession,
  getSession,
  listSessions,
  startReportCardWatchdog,
};
