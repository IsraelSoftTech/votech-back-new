const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const { Op } = require("sequelize");
const models = require("../models/index.model");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");
const { verifyPasswordAndRole } = require("../utils/freshAuth.util");
const {
  acquireYearSwitchLock,
  releaseYearSwitchLock,
} = require("./promotion.controller");

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

async function setOthersArchived(excludeId = null, transaction = null) {
  const where = excludeId
    ? { id: { [Op.ne]: excludeId }, status: "active" }
    : { status: "active" };

  const [affected] = await AcademicYearModel.update(
    { status: "archived" },
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
  const payload = { ...req.body };
  delete payload.status; // status is never set directly, see below

  const startYear = new Date(payload.start_date).getFullYear();
  const endYear = new Date(payload.end_date).getFullYear();
  payload.name = `${startYear}/${endYear} Academic Year`;

  const result = await sequelize.transaction(async (t) => {
    // Validate input
    await validateAcademicYearInput(payload, null, t);

    // The very first academic year ever created activates itself, there
    // is nothing to switch from yet. Every year created after that starts
    // archived, switchAcademicYear is the only way to make it active.
    const anyYearExists = await AcademicYearModel.findOne({ transaction: t });
    payload.status = anyYearExists ? "archived" : "active";

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

  res.status(StatusCodes.CREATED).json({ success: true, data: result });
});

const readOneAcademicYear = catchAsync(async (req, res, next) => {
  await CRUDAcademicYear.readOne(req.params.id, res);
});

const readAllAcademicYears = catchAsync(async (req, res, next) => {
  // Only Admin1 and Admin3 manage academic years and need the full list
  // (archived years included). Every other role only ever operates in the
  // active year, so that is all they are shown, regardless of what they
  // pass in the query string.
  const privileged = req.user.role === "Admin1" || req.user.role === "Admin3";
  if (!privileged) {
    req.query.status = "active";
  }
  await CRUDAcademicYear.readAll(res, req, "", 1, 100);
});

const updateAcademicYear = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  const payload = { ...req.body };

  if (payload.status !== undefined) {
    return next(
      new AppError(
        "The active academic year cannot be changed here. Use the year switch action to make a different year active.",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const updated = await sequelize.transaction(async (t) => {
    // Fetch existing record
    const existing = await AcademicYearModel.findByPk(id, { transaction: t });
    if (!existing) {
      throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
    }
    const existingPlain = existing.get({ plain: true });

    // Validate input
    await validateAcademicYearInput(payload, id, t);

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

  const [studentCount, markCount, promotionRunCount] = await Promise.all([
    models.Student.count({ where: { academic_year_id: id } }),
    models.Mark.count({ where: { academic_year_id: id } }),
    models.PromotionRun.count({
      where: {
        [Op.or]: [
          { academic_year_from_id: id },
          { academic_year_to_id: id },
        ],
      },
    }),
  ]);

  if (studentCount || markCount || promotionRunCount) {
    return next(
      new AppError(
        `Cannot delete "${academicYear.name}", it still has real data attached: ${studentCount} student(s), ${markCount} mark(s), ${promotionRunCount} promotion run(s). Deleting it would destroy that history.`,
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

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Academic year deleted successfully",
  });
});

// ─── Year switching (Admin3 only) ───────────────────────────────────────
//
// The active year moves forward only, and only one year at a time is ever
// "active" globally. This never touches archived-year data directly, it
// only flips which year is current. Retroactive edits to an archived year
// go through a grant instead (see academicYearGrant.controller.js).

// Read-only preview so the frontend can show the warning/checklist before
// the admin commits to anything, no re-auth needed just to look.
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

const switchAcademicYear = catchAsync(async (req, res, next) => {
  const { target_year_id, password, confirm_non_default } = req.body || {};

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
  if (targetYear.status === "active") {
    return next(
      new AppError("That year is already the active year", StatusCodes.BAD_REQUEST)
    );
  }

  const activeYear = await AcademicYearModel.findOne({ where: { status: "active" } });

  if (activeYear) {
    if (new Date(targetYear.start_date) <= new Date(activeYear.start_date)) {
      return next(
        new AppError(
          `Cannot switch to "${targetYear.name}", it does not start after the currently active year "${activeYear.name}". The active year can only move forward in time.`,
          StatusCodes.BAD_REQUEST
        )
      );
    }

    const laterYears = await AcademicYearModel.findAll({
      where: { start_date: { [Op.gt]: activeYear.start_date } },
      order: [["start_date", "ASC"]],
    });
    const defaultNext = laterYears[0];
    if (defaultNext && defaultNext.id !== targetYear.id && !confirm_non_default) {
      return next(
        new AppError(
          `"${targetYear.name}" skips over "${defaultNext.name}", which would normally come next. If this is intentional, resend the request with confirm_non_default: true.`,
          StatusCodes.CONFLICT
        )
      );
    }

    const stragglers = await getStragglerClasses(activeYear.id);
    if (stragglers.length) {
      return next(
        new AppError(
          `Cannot switch years yet, ${stragglers.length} class(es) still have active students in "${activeYear.name}" who have not been promoted: ${stragglers
            .map((c) => c.name)
            .join(", ")}. Run or finish their promotion first.`,
          StatusCodes.CONFLICT
        )
      );
    }
  }

  const lockAcquired = await acquireYearSwitchLock();
  if (!lockAcquired) {
    return next(
      new AppError(
        "A promotion run is currently in progress. Wait for it to finish before switching academic years.",
        StatusCodes.CONFLICT
      )
    );
  }

  try {
    const result = await sequelize.transaction(async (t) => {
      await setOthersArchived(targetYear.id, t);
      await AcademicYearModel.update(
        { status: "active" },
        { where: { id: targetYear.id }, transaction: t }
      );
      const fresh = await AcademicYearModel.findByPk(targetYear.id, { transaction: t });

      await logChanges(
        AcademicYearModel.tableName,
        targetYear.id,
        ChangeTypes.update,
        req.user,
        {
          status: { before: "archived", after: "active" },
          switched_from: {
            before: activeYear ? activeYear.name : null,
            after: fresh.name,
          },
        }
      );

      return fresh;
    });

    res.status(StatusCodes.OK).json({ success: true, data: result });
  } finally {
    await releaseYearSwitchLock();
  }
});

module.exports = {
  initAcademicYear,
  createAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  updateAcademicYear,
  deleteAcademicYear,
  getSwitchChecklist,
  switchAcademicYear,
};
