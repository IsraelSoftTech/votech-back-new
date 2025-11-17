"use strict";
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const { sequelize } = require("../db");
const { Op } = require("sequelize");

const ClassModel = models.Class;
const TeacherModel = models.users;
const DepartmentModel = models.specialties;
const ClassMasterModel = models.users;

const tableName = ClassModel.getTableName();
let CRUDClass = new CRUD(ClassModel);

async function initClass() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await ClassModel.sync({ force: false });
    }
    CRUDClass = new CRUD(ClassModel);
  } catch (err) {
    throw err;
  }
}
initClass();

// Validate foreign keys exist
async function ensureForeignKeysExist({ class_master_id, department_id }) {
  if (class_master_id) {
    const exists = await ClassMasterModel.findByPk(class_master_id);
    if (!exists) {
      throw new AppError(
        "Invalid class_master_id — record not found",
        StatusCodes.BAD_REQUEST
      );
    }
  }
  if (department_id) {
    const exists = await DepartmentModel.findByPk(department_id);
    if (!exists) {
      throw new AppError(
        "Invalid department_id — record not found",
        StatusCodes.BAD_REQUEST
      );
    }
  }
}

// Check uniqueness of class name within department
async function checkClassNameUnique(name, department_id, excludeId = null) {
  const where = { name, department_id };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const exists = await ClassModel.findOne({ where });
  if (exists) {
    throw new AppError(
      `A class with name "${name}" already exists in this department.`,
      StatusCodes.BAD_REQUEST
    );
  }
}

// Transform & validate class data
function validateClassData(data, partial = false) {
  const errors = [];

  // Name
  if (!partial || "name" in data) {
    if (
      !data.name ||
      typeof data.name !== "string" ||
      data.name.trim().length < 2
    ) {
      errors.push("Name is required and must be at least 2 characters long.");
    } else {
      data.name = data.name.trim();
    }
  }

  // Department
  if (!partial || "department_id" in data) {
    if (
      !data.department_id ||
      typeof data.department_id !== "number" ||
      data.department_id < 1
    ) {
      errors.push("Department is required and must be a valid ID.");
    }
  }

  // Class Master
  if (!partial || "class_master_id" in data) {
    if (
      !data.class_master_id ||
      typeof data.class_master_id !== "number" ||
      data.class_master_id < 1
    ) {
      errors.push("Class Master is required and must be a valid ID.");
    }
  }

  // Fees
  const feeFields = [
    "registration_fee",
    "bus_fee",
    "internship_fee",
    "remedial_fee",
    "tuition_fee",
    "pta_fee",
  ];
  let totalFee = 0;

  feeFields.forEach((field) => {
    if (field in data && data[field] != null && data[field] !== "") {
      const value = Number(data[field]);
      if (Number.isNaN(value) || value < 0) {
        errors.push(`${field.replace("_", " ")} must be a non-negative number`);
      } else {
        data[field] = value;
        totalFee += value;
      }
    } else {
      data[field] = 0;
    }
  });

  data.total_fee = totalFee;

  // Suspended
  if ("suspended" in data) {
    if (typeof data.suspended === "string") {
      data.suspended = data.suspended.toLowerCase() === "suspended";
    } else if (typeof data.suspended !== "boolean") {
      errors.push("Suspended must be a boolean or 'Suspended'/'Active' string");
    }
  } else {
    data.suspended = false;
  }

  if (errors.length > 0) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }

  return data;
}

// Associations for population
const include = [
  { model: models.ClassSubject, as: "classSubjects" },
  { model: models.specialties, as: "department" },
  { model: models.users, as: "classMaster" },
];

// Controller methods
const createClass = catchAsync(async (req, res) => {
  const data = validateClassData(req.body);
  await ensureForeignKeysExist(data);
  await checkClassNameUnique(data.name, data.department_id);
  await CRUDClass.create(data, res, req);
});

const readOneClass = catchAsync(async (req, res) => {
  await CRUDClass.readOne(req.params.id, res, include);
});

const readAllClasses = catchAsync(async (req, res) => {
  await CRUDClass.readAll(res, req, "", 1, 100, include);
});

const updateClass = catchAsync(async (req, res) => {
  const data = validateClassData(req.body, true);
  await ensureForeignKeysExist(data);
  if (data.name || data.department_id) {
    await checkClassNameUnique(
      data.name || req.body.name,
      data.department_id || req.body.department_id,
      req.params.id
    );
  }
  await CRUDClass.update(req.params.id, res, { body: data });
});

const deleteClass = catchAsync(async (req, res) => {
  await CRUDClass.delete(req.params.id, res, req);
});

module.exports = {
  createClass,
  readOneClass,
  readAllClasses,
  updateClass,
  deleteClass,
  validateClassData,
};
