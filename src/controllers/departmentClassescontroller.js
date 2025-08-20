const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const catchAsync = require("../utils/catchAsync");
const { sequelize, DataTypes } = require("../db");

const tableName = models.specialties.getTableName();

let CRUDDepartmentClassesModel = new CRUD(models.specialties);

async function initDepartmentClasses() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.specialties.sync({ force: false });
    }
    CRUDDepartmentClassesModel = new CRUD(models.specialties);
  } catch (err) {
    throw err;
  }
}

initDepartmentClasses();

const include = [
  {
    model: models.Class,
    as: "classes",
    attributes: ["id", "name"],
  },
];

const readOneDepartmentClasses = catchAsync(async (req, res, next) => {
  await CRUDDepartmentClassesModel.readOne(req.params.id, res, include);
});

const readAllDepartmentClassess = catchAsync(async (req, res, next) => {
  await CRUDDepartmentClassesModel.readAll(res, req, "", 1, 100, include);
});

module.exports = {
  readOneDepartmentClasses,
  readAllDepartmentClassess,
};
