"use strict";

const { StatusCodes } = require("http-status-codes");
const { sequelize, DataTypes } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");
const { Op } = require("sequelize");
const Joi = require("joi");
const { specialties, users } = require("../models/index.model");
const models = require("../models/index.model");

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

// controllers/classSubject.controller.js

const saveClassSubjects = catchAsync(async (req, res, next) => {
  const assignments = req.body;

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return next(
      new AppError(
        "Assignments must be a non-empty array.",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Validate each assignment has required numeric fields
  for (const [index, a] of assignments.entries()) {
    if (
      !a.class_id ||
      typeof a.class_id !== "number" ||
      !a.subject_id ||
      typeof a.subject_id !== "number" ||
      !a.teacher_id ||
      typeof a.teacher_id !== "number" ||
      !a.department_id ||
      typeof a.department_id !== "number"
    ) {
      return next(
        new AppError(
          `Invalid data at index ${index}: class_id, subject_id, teacher_id, and department_id are required and must be numbers.`,
          StatusCodes.BAD_REQUEST
        )
      );
    }
  }

  // Ensure all assignments have the same subject_id
  const uniqueSubjectIds = [...new Set(assignments.map((a) => a.subject_id))];
  if (uniqueSubjectIds.length !== 1) {
    return next(
      new AppError(
        "All assignments in a single request must have the same subject_id.",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  const subject_id = uniqueSubjectIds[0];

  // Get all involved class_ids (multiple classes allowed)
  const class_ids = [...new Set(assignments.map((a) => a.class_id))];

  // Validate all referenced classes exist
  const existingClasses = await Class.findAll({ where: { id: class_ids } });
  if (existingClasses.length !== class_ids.length) {
    const missing = class_ids.filter(
      (id) => !existingClasses.some((c) => c.id === id)
    );
    return next(
      new AppError(
        `Classes not found: ${missing.join(", ")}`,
        StatusCodes.NOT_FOUND
      )
    );
  }

  // Validate subject exists
  const subjectExists = await Subject.findByPk(subject_id);
  if (!subjectExists) {
    return next(
      new AppError(
        `Subject with id ${subject_id} not found.`,
        StatusCodes.NOT_FOUND
      )
    );
  }

  // Validate all referenced teachers exist
  const teacher_ids = [...new Set(assignments.map((a) => a.teacher_id))];
  const existingTeachers = await users.findAll({ where: { id: teacher_ids } });
  if (existingTeachers.length !== teacher_ids.length) {
    const missing = teacher_ids.filter(
      (id) => !existingTeachers.some((t) => t.id === id)
    );
    return next(
      new AppError(
        `Teachers not found: ${missing.join(", ")}`,
        StatusCodes.NOT_FOUND
      )
    );
  }

  // Validate all referenced departments exist
  const department_ids = [...new Set(assignments.map((a) => a.department_id))];
  const existingDepartments = await specialties.findAll({
    where: { id: department_ids },
  });
  if (existingDepartments.length !== department_ids.length) {
    const missing = department_ids.filter(
      (id) => !existingDepartments.some((d) => d.id === id)
    );
    return next(
      new AppError(
        `Departments not found: ${missing.join(", ")}`,
        StatusCodes.NOT_FOUND
      )
    );
  }

  // Now, delete all existing assignments for this subject in these classes before saving new ones
  const transaction = await sequelize.transaction();
  try {
    await ClassSubjectModel.destroy({
      where: { subject_id },
      transaction,
    });

    await ClassSubjectModel.bulkCreate(assignments, { transaction });

    await transaction.commit();
    return res.json({
      success: true,
      message: "Assignments saved successfully.",
    });
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
});

const unassignSubject = catchAsync(async (req, res, next) => {
  const { subject_id, class_ids } = req.body;

  if (!subject_id || typeof subject_id !== "number") {
    return next(
      new AppError(
        "subject_id is required and must be a number.",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Build the where clause
  const whereClause = { subject_id };
  if (Array.isArray(class_ids) && class_ids.length > 0) {
    whereClause.class_id = class_ids;
  }

  const transaction = await sequelize.transaction();
  try {
    const deletedCount = await ClassSubjectModel.destroy({
      where: whereClause,
      transaction,
    });

    await transaction.commit();

    return res.status(StatusCodes.OK).json({
      success: true,
      message:
        deletedCount > 0
          ? `Successfully unassigned subject ${subject_id} from ${deletedCount} class(es).`
          : "No assignments were found to unassign.",
    });
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
});

module.exports = {
  createClassSubject,
  readOneClassSubject,
  readAllClassSubjects,
  updateClassSubject,
  deleteClassSubject,
  saveClassSubjects,
  unassignSubject,
};
