const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const catchAsync = require("../utils/catchAsync");
const { sequelize, DataTypes } = require("../db");

const tableName = models.User.getTableName();

let CRUDTeachersModel = new CRUD(models.User);

async function initTeachers() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.User.sync({ force: false });
    }
    CRUDTeachersModel = new CRUD(models.User);
  } catch (err) {
    throw err;
  }
}

initTeachers();

const readOneTeacher = catchAsync(async (req, res, next) => {
  await CRUDTeachersModel.readOne(req.params.id, res);
});

const readAllTeachers = catchAsync(async (req, res, next) => {
  // req.query.role = "Teacher";
  await CRUDTeachersModel.readAll(res, req, "", 1, 100);
});

module.exports = {
  readOneTeacher,
  readAllTeachers,
};
