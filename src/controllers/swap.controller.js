const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const catchAsync = require("../utils/catchAsync");
const { sequelize, DataTypes } = require("../db");

const tableName = models.specialties.getTableName();

let CRUDDepartmentsModel = new CRUD(models.specialties);

async function initDepartments() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.specialties.sync({ force: false });
    }
    CRUDDepartmentsModel = new CRUD(models.specialties);
  } catch (err) {
    throw err;
  }
}

initDepartments();

const readOneDepartment = catchAsync(async (req, res, next) => {
  await CRUDDepartmentsModel.readOne(req.params.id, res);
});

const readAllDepartments = catchAsync(async (req, res, next) => {
  await CRUDDepartmentsModel.readAll(res, req, "", 1, 100);
});

module.exports = {
  readOneDepartment,
  readAllDepartments,
};
