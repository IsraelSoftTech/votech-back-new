const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const AcademicYearModel = require("../models/AcademicYear.model")(
  sequelize,
  DataTypes
);
const { Op } = require("sequelize");

const tableName = AcademicYearModel.getTableName();

let CRUDAcademicYear = new CRUD(AcademicYearModel);

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

async function isOverlapping(start_date, end_date, excludeId = null) {
  const whereClause = {
    [Op.and]: [
      { start_date: { [Op.lte]: end_date } },
      { end_date: { [Op.gte]: start_date } },
    ],
  };
  if (excludeId) {
    whereClause.id = { [Op.ne]: excludeId };
  }
  const overlap = await AcademicYearModel.findOne({ where: whereClause });
  return !!overlap;
}

function isDurationValid(start_date, end_date) {
  const start = new Date(start_date);
  const end = new Date(end_date);
  const diffMs = end - start;
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
  return diffMonths >= 6 && diffMonths <= 12;
}

async function validateAcademicYearInput(data, id = null) {
  const { name, start_date, end_date, status } = data;
  if (!name || !name.trim()) throw new AppError("Name is required");
  if (!start_date || !end_date)
    throw new AppError("Start and end date are required");
  if (new Date(start_date) >= new Date(end_date))
    throw new AppError("Start date must be before end date");
  if (!isDurationValid(start_date, end_date))
    throw new AppError("Academic year must be between 6 months and 1 year");
  if (await isOverlapping(start_date, end_date, id))
    throw new AppError(
      "Academic year dates overlap with existing academic year"
    );
  const existingName = await AcademicYearModel.findOne({
    where: {
      name,
      id: { [Op.ne]: id },
    },
  });
  if (existingName) throw new AppError("Academic year name must be unique");
}

async function setOthersArchived(excludeId = null) {
  const where = excludeId
    ? { id: { [Op.ne]: excludeId }, status: "active" }
    : { status: "active" };
  await AcademicYearModel.update({ status: "archived" }, { where });
}

const createAcademicYear = catchAsync(async (req, res, next) => {
  const { start_date, end_date, status } = req.body;
  if (!start_date || !end_date) {
    return next(
      new AppError(
        "Start and End date are required for creating an academic year",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (new Date(start_date) >= new Date(end_date)) {
    return next(
      new AppError(
        "Start date must be before end date",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (await isOverlapping(start_date, end_date)) {
    return next(
      new AppError(
        "Academic year already exists with an overlapping date range",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  await validateAcademicYearInput(req.body);
  if (status === "active") {
    await setOthersArchived();
  }
  await CRUDAcademicYear.create(req.body, res);
});

const readOneAcademicYear = catchAsync(async (req, res, next) => {
  await CRUDAcademicYear.readOne(req.params.id, res);
});

const readAllAcademicYears = catchAsync(async (req, res, next) => {
  await CRUDAcademicYear.readAll(res, req, "", 1, 100);
});

const updateAcademicYear = catchAsync(async (req, res, next) => {
  const { start_date, end_date, status } = req.body;
  if (!start_date || !end_date) {
    return next(
      new AppError(
        "Start and End date are required for updating an academic year",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (new Date(start_date) >= new Date(end_date)) {
    return next(
      new AppError(
        "Start date must be before end date",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (await isOverlapping(start_date, end_date, req.params.id)) {
    return next(
      new AppError(
        "Academic year already exists with an overlapping date range",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  await validateAcademicYearInput(req.body, req.params.id);
  if (status === "active") {
    await setOthersArchived(req.params.id);
  }
  await CRUDAcademicYear.update(req.params.id, res, req);
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

  await CRUDAcademicYear.delete(req.params.id, res);
});

module.exports = {
  initAcademicYear,
  createAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  updateAcademicYear,
  deleteAcademicYear,
};
