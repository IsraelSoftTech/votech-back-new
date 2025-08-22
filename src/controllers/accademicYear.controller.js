const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const { Op } = require("sequelize");
const models = require("../models/index.model");

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
    await validateAcademicYearInput(payload, null, t);

    if (payload.status === "active") {
      const affected = await setOthersArchived(null, t);
      console.log(`[AY:create] Archived ${affected} active academic year(s).`);
    }

    const ay = await AcademicYearModel.create(payload, { transaction: t });
    if (!ay || !ay.id) {
      throw new AppError(
        "Failed to create academic year",
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
        `Integrity check failed (final): terms=${termCount}, sequences=${sequenceCount}`,
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

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
    await validateAcademicYearInput(payload, id, t);

    if (payload.status === "active") {
      const affected = await setOthersArchived(id, t);
      console.log(
        `[AY:update] Archived ${affected} other active academic year(s).`
      );
    }

    const [affected] = await AcademicYearModel.update(payload, {
      where: { id },
      transaction: t,
    });

    if (!affected)
      throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);

    const fresh = await AcademicYearModel.findByPk(id, { transaction: t });
    return fresh;
  });

  res.status(StatusCodes.OK).json({ success: true, data: updated });
});

const deleteAcademicYear = catchAsync(async (req, res, next) => {
  const academicYear = await AcademicYearModel.findByPk(req.params.id);

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

  await sequelize.transaction(async (t) => {
    await AcademicYearModel.destroy({
      where: { id: req.params.id },
      transaction: t,
    });
    await TermModel.destroy({
      where: { academic_year_id: req.params.id },
      transaction: t,
    });
    await SequenceModel.destroy({
      where: { academic_year_id: req.params.id },
      transaction: t,
    });
  });

  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "Academic year deleted successfully" });
});

module.exports = {
  initAcademicYear,
  createAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  updateAcademicYear,
  deleteAcademicYear,
};
