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

const switchAcademicYear = catchAsync(async (req, res) => {
  if (req.body.confirm !== true) {
    throw new AppError(
      "Confirmation required. Set confirm: true to switch academic year.",
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

module.exports = {
  initAcademicYear,
  createAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  updateAcademicYear,
  deleteAcademicYear,
  switchAcademicYear,
  rolloverAcademicYear,
  reactivateAcademicYear,
  getActiveAcademicYear,
  getAcademicYearContext,
  getAcademicYearSwitchLogs,
};
