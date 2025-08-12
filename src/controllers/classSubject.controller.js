"use strict";

const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");
const Joi = require("joi");

const ClassSubjectModel = require("../models/ClassSubject.model")(
  sequelize,
  DataTypes
);

const Class = require("../models/classes")(sequelize, DataTypes);
const Subject = require("../models/Subject.model")(sequelize, DataTypes);
const User = require("../models/users")(sequelize, DataTypes);

const tableName = ClassSubjectModel.getTableName();

let CRUDClassSubject = new CRUD(ClassSubjectModel);

async function initClassSubject() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await ClassSubjectModel.sync({ force: false });
    }
    CRUDClassSubject = new CRUD(ClassSubjectModel);
  } catch (err) {
    throw err;
  }
}

initClassSubject();

const classSubjectSchema = Joi.object({
  class_id: Joi.number().integer().min(1).required(),
  subject_id: Joi.number().integer().min(1).required(),
  teacher_id: Joi.number().integer().min(1).required(),
});

function validateClassSubjectData(data) {
  const { error, value } = classSubjectSchema.validate(data, {
    abortEarly: false,
  });
  if (error) {
    // Aggregate all errors into a single message or keep as array
    const messages = error.details.map((detail) => detail.message).join(", ");
    const err = new Error(messages);
    err.statusCode = 400;
    throw err;
  }
  return value;
}

const createClassSubject = catchAsync(async (req, res, next) => {
  const value = validateClassSubjectData(req.body);

  const [classExists, subjectExists, teacherExists] = await Promise.all([
    Class.findByPk(value.class_id),
    Subject.findByPk(value.subject_id),
    User.findByPk(value.teacher_id),
  ]);

  if (!classExists)
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));

  if (!subjectExists)
    return next(new AppError("Subject not found", StatusCodes.NOT_FOUND));

  if (!teacherExists)
    return next(new AppError("Teacher not found", StatusCodes.NOT_FOUND));

  const alreadyExists = await ClassSubjectModel.findOne({
    where: {
      class_id: value.class_id,
      subject_id: value.subject_id,
      teacher_id: value.teacher_id,
    },
  });
  if (alreadyExists) {
    return next(
      new AppError(
        "This teacher already teaches this subject in this class",
        StatusCodes.CONFLICT
      )
    );
  }

  const newClassSubject = await ClassSubjectModel.create(value);
  appResponder(
    "Class Subject, and Teacher association created",
    newClassSubject,
    res
  );
});

const readOneClassSubject = catchAsync(async (req, res, next) => {
  await CRUDClassSubject.readOne(req.params.id, res);
});

const readAllClassSubjects = catchAsync(async (req, res, next) => {
  await CRUDClassSubject.readAll(res, req, "", 1, 100);
});

const updateClassSubject = catchAsync(async (req, res, next) => {
  const value = validateClassSubjectData(req.body);
  await CRUDClassSubject.update(req.params.id, value, res);
});

const deleteClassSubject = catchAsync(async (req, res, next) => {
  await CRUDClassSubject.delete(req.params.id, res);
});

module.exports = {
  createClassSubject,
  readOneClassSubject,
  readAllClassSubjects,
  updateClassSubject,
  deleteClassSubject,
};
