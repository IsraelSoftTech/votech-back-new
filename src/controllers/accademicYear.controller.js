const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const {
  getActiveYear,
  isYearWritable,
} = require("../services/activeAcademicYear.service");

const AcademicYearModel = require("../models/AcademicYear.model")(
  sequelize,
  DataTypes
);

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

const readOneAcademicYear = catchAsync(async (req, res) => {
  await CRUDAcademicYear.readOne(req.params.id, res);
});

const readAllAcademicYears = catchAsync(async (req, res) => {
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

module.exports = {
  initAcademicYear,
  readOneAcademicYear,
  readAllAcademicYears,
  getActiveAcademicYear,
  getAcademicYearContext,
};
