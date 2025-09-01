const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const catchAsync = require("../utils/catchAsync");
const { sequelize, DataTypes } = require("../db");

const tableName = models.students.getTableName();

let CRUDStudentsModel = new CRUD(models.students);

async function initStudents() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.students.sync({ force: false });
    }
    CRUDStudentsModel = new CRUD(models.students);
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
