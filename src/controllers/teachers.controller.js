const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const catchAsync = require("../utils/catchAsync");
const { sequelize, DataTypes } = require("../db");

const tableName = models.users.getTableName();

let CRUDTeachersModel = new CRUD(models.users);

async function initTeachers() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.users.sync({ force: false });
    }
    CRUDTeachersModel = new CRUD(models.users);
  } catch (err) {
    throw err;
  }
}

initTeachers();

const readOneTeacher = catchAsync(async (req, res, next) => {
  await CRUDTeachersModel.readOne(req.params.id, res);
});

const readAllTeachers = catchAsync(async (req, res, next) => {
  req.query.role = "Teacher";
  await CRUDTeachersModel.readAll(res, req, "", 1, 100);
});

module.exports = {
  readOneTeacher,
  readAllTeachers,
};
