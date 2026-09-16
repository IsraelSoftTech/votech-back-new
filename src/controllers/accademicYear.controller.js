const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const { Op } = require("sequelize");
const models = require("../models/index.model");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");
const {
  clearActiveYearCache,
  parseYearId,
  getActiveYear,
  isYearWritable,
} = require("../services/activeAcademicYear.service");
const { getIpAddress } = require("../../routes/utils");
const {
  getAcademicYearLinkedCounts,
  formatLinkedDataError,
} = require("../utils/academicYearLinkedData.util");
const { recordAcademicYearSwitchLog } = require("../utils/academicYearSwitchAudit.util");
const { notifyAdmin1OfYearChange } = require("../services/academicYearNotify.service");
const { verifyPasswordAndRole } = require("../utils/freshAuth.util");

const AcademicYearModel = require("../models/AcademicYear.model")(
  sequelize,
  DataTypes
);
const TermModel = require("../models/Term.model")(sequelize, DataTypes);
const SequenceModel = require("../models/Sequence.model")(sequelize, DataTypes);

const tableName = AcademicYearModel.getTableName();

let CRUDAcademicYear = new CRUD(AcademicYearModel);

// ———————————— Helpers ————————————

async function initAcademicYear() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await AcademicYearModel.sync({ force: false });
    }
    CRUDAcademicYear = new CRUD(AcademicYearModel);
  } catch (err) {
    throw err;
  }
}

async function isOverlapping(
  start_date,
  end_date,
  excludeId = null,
  transaction = null
) {
  const whereClause = {
    [Op.and]: [
      { start_date: { [Op.lte]: end_date } },
      { end_date: { [Op.gte]: start_date } },
    ],
  };
  if (excludeId) whereClause.id = { [Op.ne]: excludeId };

  const overlap = await AcademicYearModel.findOne({
    where: whereClause,
    transaction,
  });
  return !!overlap;
}

function isDurationValid(start_date, end_date) {
  const start = new Date(start_date);
  const end = new Date(end_date);
  const diffMs = end - start;
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
  return diffMonths >= 6 && diffMonths <= 12;
}

async function validateAcademicYearInput(data, id = null, transaction = null) {
  const { name, start_date, end_date } = data;

  if (!name || !name.trim()) throw new AppError("Name is required");
  if (!start_date || !end_date)
    throw new AppError("Start and end date are required");
  if (new Date(start_date) >= new Date(end_date))
    throw new AppError("Start date must be before end date");
  if (!isDurationValid(start_date, end_date))
    throw new AppError("Academic year must be between 6 months and 1 year");
  if (await isOverlapping(start_date, end_date, id, transaction))
    throw new AppError(
      "Academic year dates overlap with existing academic year"
    );

  const existingName = await AcademicYearModel.findOne({
    where: { name, id: { [Op.ne]: id } },
    transaction,
  });
  if (existingName) throw new AppError("Academic year name must be unique");
}

async function setOthersArchived(excludeId = null, transaction = null) {
  const where = excludeId
    ? { id: { [Op.ne]: excludeId }, status: "active" }
    : { status: "active" };

  const [affected] = await AcademicYearModel.update(
    { status: "archived", is_locked_for_editing: true },
    { where, transaction }
  );

  return affected;
}

// Create 3 terms and 6 sequences for a given academicYearId in one transaction
async function createDefaultTermsAndSequences(academicYearId, transaction) {
  const termsToCreate = [
    { name: "First Term", order_number: 1, academic_year_id: academicYearId },
    { name: "Second Term", order_number: 2, academic_year_id: academicYearId },
    { name: "Third Term", order_number: 3, academic_year_id: academicYearId },
  ];

  await TermModel.bulkCreate(termsToCreate, { transaction, validate: true });

  const createdTerms = await TermModel.findAll({
    where: { academic_year_id: academicYearId },
    order: [["order_number", "ASC"]],
    transaction,
  });

  if (!createdTerms || createdTerms.length !== 3) {
    throw new AppError(
      `Integrity check failed: expected 3 terms, found ${
        createdTerms?.length || 0
      }`,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }

  const [term1, term2, term3] = createdTerms;

  const sequencesToCreate = [
    {
      name: "1st Sequence",
      order_number: 1,
      term_id: term1.id,
      academic_year_id: academicYearId,
    },
    {
      name: "2nd Sequence",
      order_number: 2,
      term_id: term1.id,
      academic_year_id: academicYearId,
    },
    {
      name: "3rd Sequence",
      order_number: 3,
      term_id: term2.id,
      academic_year_id: academicYearId,
    },
    {
      name: "4th Sequence",
      order_number: 4,
      term_id: term2.id,
      academic_year_id: academicYearId,
    },
    {
      name: "5th Sequence",
      order_number: 5,
      term_id: term3.id,
      academic_year_id: academicYearId,
    },
    {
      name: "6th Sequence",
      order_number: 6,
      term_id: term3.id,
      academic_year_id: academicYearId,
    },
  ];

  await SequenceModel.bulkCreate(sequencesToCreate, {
    transaction,
    validate: true,
  });

  const seqCount = await SequenceModel.count({
    where: { academic_year_id: academicYearId },
    transaction,
  });

  if (seqCount !== 6) {
    throw new AppError(
      `Integrity check failed: expected 6 sequences, found ${seqCount}`,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }

  return { createdTerms, createdSequences: sequencesToCreate };
}

// ———————————— Controllers ————————————

const createAcademicYear = catchAsync(async (req, res, next) => {
  const payload = req.body;

  const startYear = new Date(payload.start_date).getFullYear();
  const endYear = new Date(payload.end_date).getFullYear();
  payload.name = `${startYear}/${endYear} Academic Year`;

  const result = await sequelize.transaction(async (t) => {
    // Validate input
    await validateAcademicYearInput(payload, null, t);

    // Archive other active years if needed
    if (payload.status === "active") {
      const affected = await setOthersArchived(null, t);
      console.log(`[AY:create] Archived ${affected} active academic year(s).`);
    }

    // Create academic year
    const ay = await AcademicYearModel.create(payload, { transaction: t });
    if (!ay || !ay.id) {
      throw new AppError(
        "Failed to create academic year",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // Create default terms and sequences
    await createDefaultTermsAndSequences(ay.id, t);

    // Integrity check
    const termCount = await TermModel.count({
      where: { academic_year_id: ay.id },
      transaction: t,
    });
    const sequenceCount = await SequenceModel.count({
      where: { academic_year_id: ay.id },
      transaction: t,
    });

    if (termCount !== 3 || sequenceCount !== 6) {
      throw new AppError(
        `Integrity check failed (final): terms=${termCount}, sequences=${sequenceCount}`,
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // --- Change logging ---
    const fieldsChanged = {};
    for (const key in ay.toJSON()) {
      fieldsChanged[key] = { after: ay[key] };
    }
    await logChanges(
      AcademicYearModel.tableName,
      ay.id,
      ChangeTypes.create,
      req.user,
      fieldsChanged
    );

    return ay;
  });

  clearActiveYearCache();
  res.status(StatusCodes.CREATED).json({ success: true, data: result });
});

const readOneAcademicYear = catchAsync(async (req, res, next) => {
  await CRUDAcademicYear.readOne(req.params.id, res);
});

const readAllAcademicYears = catchAsync(async (req, res, next) => {
  const includeAll =
    req.query.all === "true" ||
    req.query.all === "1" ||
    req.query.includeArchived === "true";

  if (!includeAll) {
    const active = await getActiveYear();
    const appResponder = require("../utils/appResponder");
    return appResponder(StatusCodes.OK, active ? [active] : [], res);
  }

  await CRUDAcademicYear.readAll(res, req, "", 1, 100);
});

const updateAcademicYear = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  const payload = req.body;

  const updated = await sequelize.transaction(async (t) => {
    // Fetch existing record
    const existing = await AcademicYearModel.findByPk(id, { transaction: t });
    if (!existing) {
      throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
    }
    const existingPlain = existing.get({ plain: true });

    // Validate input
    await validateAcademicYearInput(payload, id, t);

    // Archive other active years if needed
    if (payload.status === "active") {
      const affected = await setOthersArchived(id, t);
      console.log(
        `[AY:update] Archived ${affected} other active academic year(s).`
      );
    }

    // Perform update
    const [affected] = await AcademicYearModel.update(payload, {
      where: { id },
      transaction: t,
    });

    if (!affected) {
      throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
    }

    // Fetch fresh data after update
    const fresh = await AcademicYearModel.findByPk(id, { transaction: t });

    // --- Log field-level changes ---
    const fieldsChanged = {};
    for (const key in payload) {
      const oldVal = existingPlain[key];
      const newVal = fresh[key];
      if (String(oldVal) !== String(newVal)) {
        fieldsChanged[key] = { before: oldVal, after: newVal };
      }
    }

    if (Object.keys(fieldsChanged).length > 0) {
      await logChanges(
        AcademicYearModel.tableName,
        id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
    }

    return fresh;
  });

  clearActiveYearCache();
  res.status(StatusCodes.OK).json({ success: true, data: updated });
});

const deleteAcademicYear = catchAsync(async (req, res, next) => {
  const id = req.params.id;

  const academicYear = await AcademicYearModel.findByPk(id);

  if (!academicYear) {
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  }

  if (academicYear.status === "active") {
    return next(
      new AppError(
        "Cannot delete an active academic year. Please archive it first.",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const linked = await getAcademicYearLinkedCounts(id);
  if (linked.total > 0) {
    return next(
      new AppError(
        `Cannot delete this academic year because it has linked data: ${formatLinkedDataError(linked)}. Archived years with records must be kept for audit purposes.`,
        StatusCodes.CONFLICT
      )
    );
  }

  // Take snapshot BEFORE deleting
  const academicYearSnapshot = academicYear.get({ plain: true });

  await sequelize.transaction(async (t) => {
    // Fetch dependent data BEFORE deleting so we can log them too
    const terms = await TermModel.findAll({
      where: { academic_year_id: id },
      transaction: t,
    });
    const sequences = await SequenceModel.findAll({
      where: { academic_year_id: id },
      transaction: t,
    });

    // Delete main record
    await AcademicYearModel.destroy({
      where: { id },
      transaction: t,
    });

    // Log academic year deletion
    await logChanges(
      AcademicYearModel.tableName,
      id,
      ChangeTypes.delete,
      req.user,
      academicYearSnapshot
    );

    // Delete & log terms
    for (const term of terms) {
      const termSnapshot = term.get({ plain: true });

      await TermModel.destroy({
        where: { id: term.id },
        transaction: t,
      });

      await logChanges(
        TermModel.tableName,
        term.id,
        ChangeTypes.delete,
        req.user,
        termSnapshot
      );
    }

    // Delete & log sequences
    for (const seq of sequences) {
      const seqSnapshot = seq.get({ plain: true });

      await SequenceModel.destroy({
        where: { id: seq.id },
        transaction: t,
      });

      await logChanges(
        SequenceModel.tableName,
        seq.id,
        ChangeTypes.delete,
        req.user,
        seqSnapshot
      );
    }
  });

  clearActiveYearCache();
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Academic year deleted successfully",
  });
});

// Classes that still have active students sitting in the given academic
// year, this is the authoritative "not yet promoted" signal: a completed
// promotion move already moves its students' academic_year_id forward, so
// anyone left behind here genuinely was never promoted (or was reversed
// back), regardless of what the PromotionRunMove history says happened.
async function getStragglerClasses(academicYearId, transaction = null) {
  const rows = await models.Student.findAll({
    where: { academic_year_id: academicYearId, status: "active" },
    attributes: ["class_id"],
    group: ["class_id"],
    raw: true,
    transaction,
  });
  const classIds = [...new Set(rows.map((r) => r.class_id).filter(Boolean))];
  if (!classIds.length) return [];
  return models.Class.findAll({
    where: { id: { [Op.in]: classIds } },
    attributes: ["id", "name"],
    raw: true,
    transaction,
  });
}

// Read-only preview so the frontend can show the warning/checklist before
// the admin commits to anything, no re-auth needed just to look. Mirrors
// exactly the checks switchAcademicYear enforces below, so what the page
// warns about is what the switch will refuse.
const getSwitchChecklist = catchAsync(async (req, res) => {
  const activeYear = await AcademicYearModel.findOne({ where: { status: "active" } });

  if (!activeYear) {
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        active_year: null,
        default_next_year: null,
        other_years: [],
        blocking_classes: [],
        promotion_run_in_progress: false,
      },
    });
  }

  const laterYears = await AcademicYearModel.findAll({
    where: { start_date: { [Op.gt]: activeYear.start_date } },
    order: [["start_date", "ASC"]],
  });
  const blockingClasses = await getStragglerClasses(activeYear.id);
  const lock = await models.PromotionRunLock.findByPk(1);

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      active_year: activeYear,
      default_next_year: laterYears[0] || null,
      other_years: laterYears.slice(1),
      blocking_classes: blockingClasses,
      promotion_run_in_progress: !!(lock && lock.current_run_id),
    },
  });
});

const switchAcademicYear = catchAsync(async (req, res) => {
  // Two confirmation styles are accepted: the Academic Years page re-asks
  // the admin's password (fresh auth, verified against the Admin3 role),
  // older callers sent confirm: true. Either is enough, neither is skipped.
  const { password, confirm, confirm_non_default } = req.body || {};
  if (password) {
    await verifyPasswordAndRole(req.user.id, password, "Admin3");
  } else if (confirm !== true) {
    throw new AppError(
      "Confirmation required. Re-enter your password (or set confirm: true) to switch academic year.",
      StatusCodes.BAD_REQUEST
    );
  }

  const targetYearId = parseYearId(
    req.body.target_year_id ?? req.body.targetYearId
  );

  const performedBy = Number(req.user?.id);
  if (!Number.isInteger(performedBy) || performedBy <= 0) {
    throw new AppError(
      "Authenticated user id is required to switch academic year",
      StatusCodes.UNAUTHORIZED
    );
  }

  const result = await sequelize.transaction(async (t) => {
    const target = await AcademicYearModel.findByPk(targetYearId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!target) {
      throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
    }

    if (!["active", "archived"].includes(target.status)) {
      throw new AppError(
        "Only active or archived academic years can be switched to",
        StatusCodes.BAD_REQUEST
      );
    }

    const previousActive = await AcademicYearModel.findOne({
      where: { status: "active" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (target.status === "active") {
      return {
        noop: true,
        activeYear: target.get({ plain: true }),
        archivedYear: null,
        message: "Academic year is already active.",
      };
    }

    if (previousActive) {
      // The active year only moves forward in time. Going back to an
      // archived year for corrections is a different, Admin1-only action
      // (reactivateAcademicYear), not a switch.
      if (new Date(target.start_date) <= new Date(previousActive.start_date)) {
        throw new AppError(
          `Cannot switch to "${target.name}", it does not start after the currently active year "${previousActive.name}". The active year can only move forward in time.`,
          StatusCodes.BAD_REQUEST
        );
      }

      const laterYears = await AcademicYearModel.findAll({
        where: { start_date: { [Op.gt]: previousActive.start_date } },
        order: [["start_date", "ASC"]],
        transaction: t,
      });
      const defaultNext = laterYears[0];
      if (defaultNext && defaultNext.id !== target.id && !confirm_non_default) {
        throw new AppError(
          `"${target.name}" skips over "${defaultNext.name}", which would normally come next. If this is intentional, resend the request with confirm_non_default: true.`,
          StatusCodes.CONFLICT
        );
      }

      const stragglers = await getStragglerClasses(previousActive.id, t);
      if (stragglers.length) {
        throw new AppError(
          `Cannot switch years yet, ${stragglers.length} class(es) still have active students in "${previousActive.name}" who have not been promoted: ${stragglers
            .map((c) => c.name)
            .join(", ")}. Run or finish their promotion first.`,
          StatusCodes.CONFLICT
        );
      }
    }

    const fromYearId = previousActive?.id ?? null;
    const archivedYearSnapshot = previousActive
      ? previousActive.get({ plain: true })
      : null;

    await setOthersArchived(targetYearId, t);

    const now = new Date();
    await AcademicYearModel.update(
      {
        status: "active",
        is_locked_for_editing: false,
        switched_at: now,
        switched_by: performedBy,
        reactivated_at: null,
        reactivated_by: null,
      },
      { where: { id: targetYearId }, transaction: t }
    );

    await recordAcademicYearSwitchLog(
      {
        from_year_id: fromYearId,
        to_year_id: targetYearId,
        action: "switch",
        performed_by: performedBy,
        performed_at: now,
        reason: req.body.reason?.trim?.() || null,
        ip_address: getIpAddress(req),
      },
      req.user,
      t
    );

    const activeYear = await AcademicYearModel.findByPk(targetYearId, {
      transaction: t,
    });

    let archivedYear = null;
    if (fromYearId) {
      archivedYear = await AcademicYearModel.findByPk(fromYearId, {
        transaction: t,
      });
    }

    if (archivedYearSnapshot && archivedYear) {
      await logChanges(
        AcademicYearModel.tableName,
        fromYearId,
        ChangeTypes.update,
        req.user,
        {
          status: { before: archivedYearSnapshot.status, after: "archived" },
          is_locked_for_editing: {
            before: archivedYearSnapshot.is_locked_for_editing,
            after: true,
          },
        }
      );
    }

    await logChanges(
      AcademicYearModel.tableName,
      targetYearId,
      ChangeTypes.update,
      req.user,
      {
        status: { before: "archived", after: "active" },
        switched_at: { after: now.toISOString() },
        switched_by: { after: performedBy },
      }
    );

    return {
      noop: false,
      activeYear: activeYear.get({ plain: true }),
      archivedYear: archivedYear ? archivedYear.get({ plain: true }) : null,
      message: `Academic year switched to ${activeYear.name}.`,
    };
  });

  clearActiveYearCache();

  if (!result.noop && req.user?.role === "Admin3") {
    await notifyAdmin1OfYearChange({
      performer: req.user,
      activeYear: result.activeYear,
      archivedYear: result.archivedYear,
      action: "switch",
      reason: req.body.reason?.trim?.() || null,
    });
  }

  res.status(StatusCodes.OK).json({
    success: true,
    activeYear: result.activeYear,
    archivedYear: result.archivedYear,
    message: result.message,
  });
});

const rolloverAcademicYear = catchAsync(async (req, res) => {
  if (req.body.confirm !== true) {
    throw new AppError(
      "Confirmation required. Set confirm: true to start a new academic year.",
      StatusCodes.BAD_REQUEST
    );
  }

  const activateImmediately = req.body.activate_immediately ?? true;
  if (activateImmediately !== true) {
    throw new AppError(
      "Academic year rollover must activate the new year. Set activate_immediately: true.",
      StatusCodes.BAD_REQUEST
    );
  }

  const { start_date, end_date } = req.body;
  if (!start_date || !end_date) {
    throw new AppError(
      "Start and end date are required for rollover",
      StatusCodes.BAD_REQUEST
    );
  }

  const performedBy = Number(req.user?.id);
  if (!Number.isInteger(performedBy) || performedBy <= 0) {
    throw new AppError(
      "Authenticated user id is required to rollover academic year",
      StatusCodes.UNAUTHORIZED
    );
  }

  const startYear = new Date(start_date).getFullYear();
  const endYear = new Date(end_date).getFullYear();
  const name = `${startYear}/${endYear} Academic Year`;

  const result = await sequelize.transaction(async (t) => {
    const previousActive = await AcademicYearModel.findOne({
      where: { status: "active" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const fromYearId = previousActive?.id ?? null;
    const archivedYearSnapshot = previousActive
      ? previousActive.get({ plain: true })
      : null;

    const payload = {
      name,
      start_date,
      end_date,
      status: "active",
      is_locked_for_editing: false,
    };

    await validateAcademicYearInput(payload, null, t);

    const archivedCount = await setOthersArchived(null, t);
    if (archivedCount > 0) {
      console.log(
        `[AY:rollover] Archived ${archivedCount} active academic year(s).`
      );
    }

    const now = new Date();
    const ay = await AcademicYearModel.create(
      {
        ...payload,
        switched_at: now,
        switched_by: performedBy,
        reactivated_at: null,
        reactivated_by: null,
      },
      { transaction: t }
    );

    if (!ay?.id) {
      throw new AppError(
        "Failed to create academic year during rollover",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    await createDefaultTermsAndSequences(ay.id, t);

    const termCount = await TermModel.count({
      where: { academic_year_id: ay.id },
      transaction: t,
    });
    const sequenceCount = await SequenceModel.count({
      where: { academic_year_id: ay.id },
      transaction: t,
    });

    if (termCount !== 3 || sequenceCount !== 6) {
      throw new AppError(
        `Integrity check failed (rollover): terms=${termCount}, sequences=${sequenceCount}`,
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    await recordAcademicYearSwitchLog(
      {
        from_year_id: fromYearId,
        to_year_id: ay.id,
        action: "switch",
        performed_by: performedBy,
        performed_at: now,
        reason:
          req.body.reason?.trim?.() ||
          `Rollover to ${name}`,
        ip_address: getIpAddress(req),
      },
      req.user,
      t
    );

    const fieldsChanged = {};
    for (const key of Object.keys(ay.toJSON())) {
      fieldsChanged[key] = { after: ay[key] };
    }
    await logChanges(
      AcademicYearModel.tableName,
      ay.id,
      ChangeTypes.create,
      req.user,
      fieldsChanged
    );

    if (archivedYearSnapshot && fromYearId) {
      await logChanges(
        AcademicYearModel.tableName,
        fromYearId,
        ChangeTypes.update,
        req.user,
        {
          status: { before: archivedYearSnapshot.status, after: "archived" },
          is_locked_for_editing: {
            before: archivedYearSnapshot.is_locked_for_editing,
            after: true,
          },
        }
      );
    }

    const activeYear = await AcademicYearModel.findByPk(ay.id, { transaction: t });
    let archivedYear = null;
    if (fromYearId) {
      archivedYear = await AcademicYearModel.findByPk(fromYearId, {
        transaction: t,
      });
    }

    return {
      activeYear: activeYear.get({ plain: true }),
      archivedYear: archivedYear ? archivedYear.get({ plain: true }) : null,
      message: `New academic year ${name} is now active.`,
    };
  });

  clearActiveYearCache();

  if (req.user?.role === "Admin3") {
    await notifyAdmin1OfYearChange({
      performer: req.user,
      activeYear: result.activeYear,
      archivedYear: result.archivedYear,
      action: "rollover",
      reason: req.body.reason?.trim?.() || null,
    });
  }

  res.status(StatusCodes.CREATED).json({
    success: true,
    activeYear: result.activeYear,
    archivedYear: result.archivedYear,
    message: result.message,
  });
});

const reactivateAcademicYear = catchAsync(async (req, res) => {
  if (req.body.confirm !== true) {
    throw new AppError(
      "Confirmation required. Set confirm: true to reactivate an academic year.",
      StatusCodes.BAD_REQUEST
    );
  }

  const reason = req.body.reason?.trim?.();
  if (!reason) {
    throw new AppError(
      "A reason is required to reactivate an archived academic year.",
      StatusCodes.BAD_REQUEST
    );
  }

  const targetYearId = parseYearId(req.params.id);
  const performedBy = Number(req.user?.id);
  if (!Number.isInteger(performedBy) || performedBy <= 0) {
    throw new AppError(
      "Authenticated user id is required to reactivate academic year",
      StatusCodes.UNAUTHORIZED
    );
  }

  const result = await sequelize.transaction(async (t) => {
    const target = await AcademicYearModel.findByPk(targetYearId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!target) {
      throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
    }

    if (target.status !== "archived") {
      throw new AppError(
        "Only archived academic years can be reactivated",
        StatusCodes.BAD_REQUEST
      );
    }

    const previousActive = await AcademicYearModel.findOne({
      where: { status: "active" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (previousActive?.id === targetYearId) {
      return {
        activeYear: target.get({ plain: true }),
        archivedYear: null,
        message: "Academic year is already active.",
      };
    }

    const fromYearId = previousActive?.id ?? null;
    const archivedYearSnapshot = previousActive
      ? previousActive.get({ plain: true })
      : null;

    await setOthersArchived(targetYearId, t);

    const now = new Date();
    await AcademicYearModel.update(
      {
        status: "active",
        is_locked_for_editing: false,
        reactivated_at: now,
        reactivated_by: performedBy,
      },
      { where: { id: targetYearId }, transaction: t }
    );

    await recordAcademicYearSwitchLog(
      {
        from_year_id: fromYearId,
        to_year_id: targetYearId,
        action: "reactivate",
        performed_by: performedBy,
        performed_at: now,
        reason,
        ip_address: getIpAddress(req),
      },
      req.user,
      t
    );

    if (archivedYearSnapshot && fromYearId) {
      await logChanges(
        AcademicYearModel.tableName,
        fromYearId,
        ChangeTypes.update,
        req.user,
        {
          status: { before: archivedYearSnapshot.status, after: "archived" },
          is_locked_for_editing: {
            before: archivedYearSnapshot.is_locked_for_editing,
            after: true,
          },
        }
      );
    }

    await logChanges(
      AcademicYearModel.tableName,
      targetYearId,
      ChangeTypes.update,
      req.user,
      {
        status: { before: "archived", after: "active" },
        reactivated_at: { after: now.toISOString() },
        reactivated_by: { after: performedBy },
      }
    );

    const activeYear = await AcademicYearModel.findByPk(targetYearId, {
      transaction: t,
    });
    let archivedYear = null;
    if (fromYearId) {
      archivedYear = await AcademicYearModel.findByPk(fromYearId, {
        transaction: t,
      });
    }

    return {
      activeYear: activeYear.get({ plain: true }),
      archivedYear: archivedYear ? archivedYear.get({ plain: true }) : null,
      message: `Academic year ${activeYear.name} reactivated for editing.`,
    };
  });

  clearActiveYearCache();

  res.status(StatusCodes.OK).json({
    success: true,
    activeYear: result.activeYear,
    archivedYear: result.archivedYear,
    message: result.message,
  });
});

const getActiveAcademicYear = catchAsync(async (req, res) => {
  const active = await getActiveYear({ bypassCache: false });

  if (!active) {
    return res.status(StatusCodes.OK).json({
      success: true,
      data: null,
    });
  }

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      id: active.id,
      name: active.name,
      start_date: active.start_date,
      end_date: active.end_date,
      status: active.status,
      isWritable: await isYearWritable(active.id),
    },
  });
});

const getAcademicYearContext = catchAsync(async (req, res) => {
  const role = req.user?.role;
  const active = await getActiveYear({ bypassCache: false });

  const archivedRows = await AcademicYearModel.findAll({
    where: { status: "archived" },
    order: [["end_date", "DESC"]],
    attributes: [
      "id",
      "name",
      "start_date",
      "end_date",
      "status",
      "switched_at",
      "reactivated_at",
      "is_locked_for_editing",
    ],
  });

  const archivedYears = archivedRows.map((row) => {
    const plain = row.get({ plain: true });
    return {
      ...plain,
      isWritable: false,
    };
  });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      activeYear: active
        ? {
            id: active.id,
            name: active.name,
            start_date: active.start_date,
            end_date: active.end_date,
            status: active.status,
            isWritable: true,
          }
        : null,
      archivedYears,
      permissions: {
        canSwitch: role === "Admin3",
        canRollover: role === "Admin3",
        canReactivate: role === "Admin1",
      },
    },
  });
});

const getAcademicYearSwitchLogs = catchAsync(async (req, res) => {
  const { AcademicYearSwitchLog, User } = models;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

  const logs = await AcademicYearSwitchLog.findAll({
    order: [["performed_at", "DESC"]],
    limit,
    include: [
      {
        model: AcademicYearModel,
        as: "fromYear",
        attributes: ["id", "name"],
        required: false,
      },
      {
        model: AcademicYearModel,
        as: "toYear",
        attributes: ["id", "name"],
        required: false,
      },
      {
        model: User,
        as: "performedByUser",
        attributes: ["id", "username", "name"],
        required: false,
      },
    ],
  });

  const data = logs.map((log) => {
    const plain = log.get({ plain: true });
    const performer = plain.performedByUser;
    return {
      id: plain.id,
      action: plain.action,
      performed_at: plain.performed_at,
      reason: plain.reason,
      fromYear: plain.fromYear,
      toYear: plain.toYear,
      performedBy: performer
        ? performer.name || performer.username
        : null,
    };
  });

  res.status(StatusCodes.OK).json({ success: true, data });
});

// ─── Year overview (Academic Year detail page) ───────────────────────────
//
// One payload for the whole detail page, all counts computed in SQL so the
// server never materializes a year's students or marks just to count them
// (the VPS has 1GB, see reportCardChunkedGenerator.util.js for why that
// matters). Every number here mirrors an existing rule elsewhere rather
// than inventing a new one: "expected marks" is computeCoverage's formula
// (marksOverview.controller.js), "never promoted" is the switch's straggler
// check (getStragglerClasses above), so the detail page can never disagree
// with the screens it links to.

const getAcademicYearOverview = catchAsync(async (req, res, next) => {
  const yearId = parseYearId(req.params.id);
  // models.AcademicYear, not this file's AcademicYearModel: the
  // switchedByUser/reactivatedByUser associations are wired on the shared
  // instance from index.model.js.
  const year = await models.AcademicYear.findByPk(yearId, {
    include: [
      { model: models.User, as: "switchedByUser", attributes: ["id", "name", "username"], required: false },
      { model: models.User, as: "reactivatedByUser", attributes: ["id", "name", "username"], required: false },
    ],
  });
  if (!year) return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));

  const q = (sql) => sequelize.query(sql, { replacements: { yearId }, type: sequelize.QueryTypes.SELECT });

  const [
    terms,
    sequencesPerTerm,
    studentsPerClass,
    classSubjectsPerClass,
    marksPerTerm,
    unmarkedPerTerm,
    reportCardAgg,
    reportCardClasses,
    promotionRuns,
    promotionDecisions,
    stragglers,
    classMasterRows,
    unassignedClassSubjects,
    logs,
  ] = await Promise.all([
    TermModel.findAll({ where: { academic_year_id: yearId }, order: [["order_number", "ASC"]], raw: true }),
    q(`SELECT term_id, COUNT(*)::int AS sequences FROM sequences WHERE academic_year_id = :yearId GROUP BY term_id`),
    q(`SELECT class_id, COUNT(*)::int AS students,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_students,
              COUNT(*) FILTER (WHERE sex ILIKE 'm%')::int AS male,
              COUNT(*) FILTER (WHERE sex ILIKE 'f%')::int AS female
       FROM students WHERE academic_year_id = :yearId GROUP BY class_id`),
    q(`SELECT class_id, COUNT(*)::int AS subjects,
              COUNT(*) FILTER (WHERE teacher_id IS NULL)::int AS without_teacher
       FROM class_subjects WHERE academic_year_id = :yearId GROUP BY class_id`),
    q(`SELECT term_id, COUNT(*)::int AS filled FROM marks WHERE academic_year_id = :yearId GROUP BY term_id`),
    // Class subjects (per term) that have not a single mark yet.
    q(`SELECT t.id AS term_id, COUNT(*)::int AS subjects_without_marks
       FROM terms t
       JOIN class_subjects cs ON cs.academic_year_id = t.academic_year_id
       WHERE t.academic_year_id = :yearId
         AND NOT EXISTS (
           SELECT 1 FROM marks m
           WHERE m.academic_year_id = cs.academic_year_id
             AND m.class_id = cs.class_id AND m.subject_id = cs.subject_id AND m.term_id = t.id
         )
       GROUP BY t.id`),
    q(`SELECT COUNT(*)::int AS sessions,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_sessions,
              MAX(completed_at) AS last_completed_at
       FROM report_card_sessions WHERE academic_year_id = :yearId`),
    q(`SELECT COUNT(DISTINCT r.class_id)::int AS classes_generated
       FROM report_card_runs r JOIN report_card_sessions s ON s.id = r.session_id
       WHERE s.academic_year_id = :yearId AND r.status = 'completed'`),
    q(`SELECT COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs,
              MAX(completed_at) AS last_completed_at
       FROM promotion_runs WHERE academic_year_from_id = :yearId`),
    q(`SELECT decision, COUNT(*)::int AS students,
              COUNT(*) FILTER (WHERE was_repeating)::int AS repeating
       FROM student_promotions WHERE from_academic_year_id = :yearId GROUP BY decision`),
    getStragglerClasses(yearId),
    q(`SELECT class_id FROM class_master_assignments WHERE academic_year_id = :yearId`),
    q(`SELECT cs.class_id, c.name AS class_name, cs.subject_id, s.name AS subject_name, s.code AS subject_code
       FROM class_subjects cs
       JOIN classes c ON c.id = cs.class_id
       JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.academic_year_id = :yearId AND cs.teacher_id IS NULL
       ORDER BY c.name, s.name LIMIT 100`),
    models.AcademicYearSwitchLog.findAll({
      where: { [Op.or]: [{ from_year_id: yearId }, { to_year_id: yearId }] },
      order: [["performed_at", "DESC"]],
      limit: 30,
      include: [
        { model: AcademicYearModel, as: "fromYear", attributes: ["id", "name"], required: false },
        { model: AcademicYearModel, as: "toYear", attributes: ["id", "name"], required: false },
        { model: models.User, as: "performedByUser", attributes: ["id", "username", "name"], required: false },
      ],
    }),
  ]);

  // Classes: everything not suspended, so a class the year forgot to fill
  // shows up as "0 students" instead of silently disappearing.
  const classes = await models.Class.findAll({
    where: { suspended: false },
    attributes: ["id", "name", "department_id", "is_orientation"],
    include: [{ model: models.Specialty, as: "department", attributes: ["id", "name", "abbreviation"] }],
    order: [["name", "ASC"]],
  });
  const studentsByClass = new Map(studentsPerClass.map((r) => [r.class_id, r]));
  const subjectsByClass = new Map(classSubjectsPerClass.map((r) => [r.class_id, r]));
  const classesWithMaster = new Set(classMasterRows.map((r) => r.class_id));

  const classRows = classes.map((c) => {
    const st = studentsByClass.get(c.id);
    const cs = subjectsByClass.get(c.id);
    return {
      class_id: c.id,
      class_name: c.name,
      department: c.department ? { id: c.department.id, name: c.department.name } : null,
      is_orientation: !!c.is_orientation,
      students: st ? st.students : 0,
      active_students: st ? st.active_students : 0,
      male: st ? st.male : 0,
      female: st ? st.female : 0,
      subjects: cs ? cs.subjects : 0,
      has_class_master: classesWithMaster.has(c.id),
    };
  });
  const classesWithStudents = classRows.filter((r) => r.students > 0);

  const seqByTerm = new Map(sequencesPerTerm.map((r) => [r.term_id, r.sequences]));
  const filledByTerm = new Map(marksPerTerm.map((r) => [r.term_id, r.filled]));
  const unmarkedByTerm = new Map(unmarkedPerTerm.map((r) => [r.term_id, r.subjects_without_marks]));
  // computeCoverage's formula: every (class subject x student x sequence)
  // triple is one expected mark.
  const pairsPerSequence = classRows.reduce((sum, r) => sum + r.students * r.subjects, 0);
  const termRows = terms.map((t) => {
    const sequences = seqByTerm.get(t.id) || 0;
    const expected = pairsPerSequence * sequences;
    const filled = filledByTerm.get(t.id) || 0;
    return {
      term_id: t.id,
      name: t.name,
      order_number: t.order_number,
      sequences,
      expected_marks: expected,
      filled_marks: filled,
      percent: expected ? Math.min(100, Math.round((filled / expected) * 1000) / 10) : 0,
      subjects_without_marks: unmarkedByTerm.get(t.id) || 0,
    };
  });

  const decisions = { promoted: 0, promoted_on_condition: 0, failed: 0 };
  let repeating = 0;
  for (const d of promotionDecisions) {
    if (d.decision in decisions) decisions[d.decision] = d.students;
    repeating += d.repeating;
  }
  const stragglerStudents = stragglers.length
    ? classRows
        .filter((r) => stragglers.some((sc) => sc.id === r.class_id))
        .reduce((n, r) => n + r.active_students, 0)
    : 0;

  const now = new Date();
  const isAdmin1 = req.user?.role === "Admin1";
  // Grants are Admin1's business (same rule as academicYearGrant.route.js),
  // Admin3 gets the log but not the grant list.
  const grants = isAdmin1
    ? await models.AcademicYearGrant.findAll({
        where: { academic_year_id: yearId },
        order: [["granted_at", "DESC"]],
        limit: 20,
        include: [
          { association: models.AcademicYearGrant.associations.grantor, attributes: ["id", "name", "username"] },
          { association: models.AcademicYearGrant.associations.revoker, attributes: ["id", "name", "username"] },
        ],
      })
    : null;

  const userLabel = (u) => (u ? u.name || u.username : null);
  const plainYear = year.get({ plain: true });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      year: {
        id: plainYear.id,
        name: plainYear.name,
        status: plainYear.status,
        start_date: plainYear.start_date,
        end_date: plainYear.end_date,
        is_locked_for_editing: !!plainYear.is_locked_for_editing,
        switched_at: plainYear.switched_at,
        switched_by: userLabel(plainYear.switchedByUser),
        reactivated_at: plainYear.reactivated_at,
        reactivated_by: userLabel(plainYear.reactivatedByUser),
        created_at: plainYear.createdAt,
      },
      terms: termRows,
      enrollment: {
        total_students: classRows.reduce((n, r) => n + r.students, 0),
        active_students: classRows.reduce((n, r) => n + r.active_students, 0),
        male: classRows.reduce((n, r) => n + r.male, 0),
        female: classRows.reduce((n, r) => n + r.female, 0),
        classes_with_students: classesWithStudents.length,
        classes_without_students: classRows.length - classesWithStudents.length,
        classes: classRows,
      },
      report_cards: {
        sessions: reportCardAgg[0]?.sessions || 0,
        completed_sessions: reportCardAgg[0]?.completed_sessions || 0,
        last_completed_at: reportCardAgg[0]?.last_completed_at || null,
        classes_generated: reportCardClasses[0]?.classes_generated || 0,
        classes_total: classesWithStudents.length,
      },
      promotion: {
        runs: promotionRuns[0]?.runs || 0,
        completed_runs: promotionRuns[0]?.completed_runs || 0,
        last_completed_at: promotionRuns[0]?.last_completed_at || null,
        decisions,
        repeating,
        never_promoted_students: stragglerStudents,
        never_promoted_classes: stragglers,
      },
      governance: {
        logs: logs.map((log) => {
          const p = log.get({ plain: true });
          return {
            id: p.id,
            action: p.action,
            performed_at: p.performed_at,
            reason: p.reason,
            from_year: p.fromYear,
            to_year: p.toYear,
            performed_by: userLabel(p.performedByUser),
          };
        }),
        grants: grants
          ? grants.map((g) => {
              const p = g.get({ plain: true });
              const revoked = !!p.revoked_at;
              const expired = !revoked && new Date(p.expires_at) <= now;
              return {
                id: p.id,
                is_global: p.is_global,
                admin3_user_ids: p.admin3_user_ids,
                reason: p.reason,
                granted_at: p.granted_at,
                expires_at: p.expires_at,
                revoked_at: p.revoked_at,
                granted_by: userLabel(p.grantor),
                revoked_by: userLabel(p.revoker),
                state: revoked ? "revoked" : expired ? "expired" : "active",
              };
            })
          : null,
        active_grants: grants ? grants.filter((g) => !g.revoked_at && new Date(g.expires_at) > now).length : null,
      },
      setup_health: {
        classes_without_master: classesWithStudents
          .filter((r) => !r.has_class_master)
          .map((r) => ({ class_id: r.class_id, class_name: r.class_name })),
        class_subjects_without_teacher: unassignedClassSubjects,
        class_subjects_without_teacher_total: classSubjectsPerClass.reduce((n, r) => n + r.without_teacher, 0),
      },
    },
  });
});

// ─── Carry Forward year-scoped values (Admin3) ──────────────────────────
//
// Copies everything the school would otherwise have to set up again from
// scratch in a new year, from the currently active year into a target
// year, as brand new independently-editable rows:
//
//   • class_subjects            (which teacher teaches what, per class)
//   • class_master_assignments  (who is class master of each class)
//   • academic_bands            (grading bands and their comments)
//   • subject_year_settings     (subject coefficients and categories)
//   • class_year_settings       (class names and departments)
//   • school_setting_years      (school name and principal)
//
// Never touches the source year's rows, never touches which year is
// active. Idempotent-safe: anything that already exists for the target
// year is skipped rather than duplicated, so running it twice is
// harmless. Offered to Admin3 as a step of the switch-year flow.

const carryForwardAssignments = catchAsync(async (req, res, next) => {
  const { target_year_id, password } = req.body || {};

  await verifyPasswordAndRole(req.user.id, password, "Admin3");

  if (!target_year_id) {
    return next(
      new AppError("target_year_id is required", StatusCodes.BAD_REQUEST)
    );
  }

  const targetYear = await AcademicYearModel.findByPk(target_year_id);
  if (!targetYear) {
    return next(
      new AppError("Target academic year not found", StatusCodes.NOT_FOUND)
    );
  }

  const activeYear = await AcademicYearModel.findOne({
    where: { status: "active" },
  });
  if (!activeYear) {
    return next(
      new AppError(
        "There is no active academic year to carry forward from",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (activeYear.id === targetYear.id) {
    return next(
      new AppError(
        "The target year is already the active year",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const result = await sequelize.transaction(async (t) => {
    // ── class_subjects ──
    const sourceSubjects = await models.ClassSubject.findAll({
      where: { academic_year_id: activeYear.id },
      raw: true,
      transaction: t,
    });
    const existingSubjectRows = await models.ClassSubject.findAll({
      where: { academic_year_id: targetYear.id },
      attributes: ["class_id", "subject_id", "department_id"],
      raw: true,
      transaction: t,
    });
    const existingSubjectKeys = new Set(
      existingSubjectRows.map(
        (r) => `${r.class_id}-${r.subject_id}-${r.department_id}`
      )
    );
    const subjectsToCreate = sourceSubjects
      .filter(
        (r) =>
          !existingSubjectKeys.has(
            `${r.class_id}-${r.subject_id}-${r.department_id}`
          )
      )
      .map((r) => ({
        academic_year_id: targetYear.id,
        class_id: r.class_id,
        subject_id: r.subject_id,
        department_id: r.department_id,
        teacher_id: r.teacher_id,
      }));
    if (subjectsToCreate.length) {
      await models.ClassSubject.bulkCreate(subjectsToCreate, {
        transaction: t,
        individualHooks: true,
        skipYearLockCheck: true,
      });
    }

    // ── class_master_assignments ──
    const sourceMasters = await models.ClassMasterAssignment.findAll({
      where: { academic_year_id: activeYear.id },
      raw: true,
      transaction: t,
    });
    const existingMasterRows = await models.ClassMasterAssignment.findAll({
      where: { academic_year_id: targetYear.id },
      attributes: ["class_id"],
      raw: true,
      transaction: t,
    });
    const existingMasterClassIds = new Set(
      existingMasterRows.map((r) => r.class_id)
    );
    const mastersToCreate = sourceMasters
      .filter((r) => !existingMasterClassIds.has(r.class_id))
      .map((r) => ({
        academic_year_id: targetYear.id,
        class_id: r.class_id,
        teacher_id: r.teacher_id,
      }));
    if (mastersToCreate.length) {
      await models.ClassMasterAssignment.bulkCreate(mastersToCreate, {
        transaction: t,
        individualHooks: true,
        skipYearLockCheck: true,
      });
    }

    // ── the remaining year-scoped tables ──
    //
    // All four follow the same shape as the two above: read the active
    // year's rows, work out which of them the target year doesn't have
    // yet using that table's own uniqueness key, and create only those.
    // Driven off a table rather than four more copy-pasted blocks so a
    // future year-scoped table is one entry, not another 30 lines.
    const copyPlans = [
      {
        key: "academic_bands",
        model: models.AcademicBand,
        // A class can define several bands, so identity here is the whole
        // band, not just the class.
        identity: (r) => `${r.class_id}-${r.band_min}-${r.band_max}`,
        fields: ["class_id", "band_min", "band_max", "comment"],
      },
      {
        key: "subject_year_settings",
        model: models.SubjectYearSetting,
        identity: (r) => String(r.subject_id),
        fields: ["subject_id", "coefficient", "category"],
      },
      {
        key: "class_year_settings",
        model: models.ClassYearSetting,
        identity: (r) => String(r.class_id),
        fields: ["class_id", "name", "department_id"],
      },
      {
        key: "school_setting_years",
        model: models.SchoolSettingYear,
        // One row per year, so every source row maps to the same slot.
        identity: () => "school",
        fields: ["school_name", "principal_name"],
      },
    ];

    const counts = {};
    for (const plan of copyPlans) {
      const sourceRows = await plan.model.findAll({
        where: { academic_year_id: activeYear.id },
        raw: true,
        transaction: t,
      });
      const existingRows = await plan.model.findAll({
        where: { academic_year_id: targetYear.id },
        raw: true,
        transaction: t,
      });
      const existingKeys = new Set(existingRows.map(plan.identity));

      const toCreate = sourceRows
        .filter((r) => !existingKeys.has(plan.identity(r)))
        .map((r) => {
          const row = { academic_year_id: targetYear.id };
          for (const field of plan.fields) row[field] = r[field];
          return row;
        });

      if (toCreate.length) {
        await plan.model.bulkCreate(toCreate, {
          transaction: t,
          individualHooks: true,
          skipYearLockCheck: true,
        });
      }

      counts[`${plan.key}_created`] = toCreate.length;
      counts[`${plan.key}_skipped`] = sourceRows.length - toCreate.length;
    }

    return {
      source_year: { id: activeYear.id, name: activeYear.name },
      target_year: { id: targetYear.id, name: targetYear.name },
      class_subjects_created: subjectsToCreate.length,
      class_subjects_skipped: sourceSubjects.length - subjectsToCreate.length,
      class_master_assignments_created: mastersToCreate.length,
      class_master_assignments_skipped:
        sourceMasters.length - mastersToCreate.length,
      ...counts,
    };
  });

  res.status(StatusCodes.OK).json({ success: true, data: result });
});

module.exports = {
  initAcademicYear,
  createAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  updateAcademicYear,
  deleteAcademicYear,
  getSwitchChecklist,
  getAcademicYearOverview,
  switchAcademicYear,
  rolloverAcademicYear,
  reactivateAcademicYear,
  getActiveAcademicYear,
  getAcademicYearContext,
  getAcademicYearSwitchLogs,
  carryForwardAssignments,
};
