const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const { Op } = require("sequelize");
const models = require("../models/index.model");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");

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

  res.status(StatusCodes.CREATED).json({ success: true, data: result });
});

const readOneAcademicYear = catchAsync(async (req, res, next) => {
  await CRUDAcademicYear.readOne(req.params.id, res);
});

const readAllAcademicYears = catchAsync(async (req, res, next) => {
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

module.exports = {
  initAcademicYear,
  createAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  updateAcademicYear,
  deleteAcademicYear,
};
