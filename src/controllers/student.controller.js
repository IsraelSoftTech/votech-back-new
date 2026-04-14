const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const catchAsync = require("../utils/catchAsync");
const { sequelize, DataTypes } = require("../db");

const tableName = models.Student.getTableName();

let CRUDStudentsModel = new CRUD(models.Student);

async function initStudents() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.Student.sync({ force: false });
    }
    CRUDStudentsModel = new CRUD(models.Student);
  } catch (err) {
    throw err;
  }
}

initStudents();

const readOneStudent = catchAsync(async (req, res, next) => {
  await CRUDStudentsModel.readOne(req.params.id, res);
});

const readAllStudents = catchAsync(async (req, res, next) => {
  await CRUDStudentsModel.readAll(res, req, "", 1, 10000);
});

module.exports = {
  readOneStudent,
  readAllStudents,
};
