"use strict";
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const { sequelize } = require("../db");
const { Op } = require("sequelize");
const appResponder = require("../utils/appResponder");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");
const { assertYearWritable } = require("../utils/yearLock.util");

const ClassModel = models.Class;
const TeacherModel = models.User;
const DepartmentModel = models.Specialty;
const ClassMasterModel = models.User;

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

// Keeps class_master_assignments (the year-scoped source of truth report
// cards actually read) in sync whenever classes.class_master_id changes.
// classes.class_master_id itself stays as-is, a denormalized "who's the
// CURRENT master" convenience field the rest of the admin UI already
// reads directly, this just also records it against the active year so
// history isn't lost the next time someone gets reassigned.
async function syncClassMasterAssignment(classId, teacherId) {
  if (!teacherId) return;
  const activeYear = await models.AcademicYear.findOne({ where: { status: "active" } });
  if (!activeYear) return;
  const [row, created] = await models.ClassMasterAssignment.findOrCreate({
    where: { academic_year_id: activeYear.id, class_id: classId },
    defaults: { teacher_id: teacherId },
  });
  if (!created && row.teacher_id !== teacherId) {
    await row.update({ teacher_id: teacherId }, { skipYearLockCheck: true });
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

  // is_orientation — drives whether registration captures the six ranked
  // department choices and whether promotion later restricts this
  // class's students to their chosen departments (see
  // StudentDepartmentChoice). Only meaningful on create/full update, a
  // partial update that doesn't mention it should leave the existing
  // value alone rather than silently resetting it to false.
  if ("is_orientation" in data) {
    if (typeof data.is_orientation !== "boolean") {
      errors.push("is_orientation must be a boolean");
    }
  } else if (!partial) {
    data.is_orientation = false;
  }

  if (errors.length > 0) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }

  return data;
}

// Associations for population
const include = [
  { model: models.ClassSubject, as: "classSubjects" },
  { model: models.Specialty, as: "department" },
  { model: models.User, as: "classMaster" },
];

// Richer than `include` above on purpose: the class list (readAllClasses)
// stays lightweight since it loads every class at once, but the single-
// class detail page wants the subject/teacher on each classSubjects row
// (its Subjects tab links out to each, and shows who teaches it), which
// would be a wasteful 3-level-deep join across the whole list.
const includeDetail = [
  {
    model: models.ClassSubject,
    as: "classSubjects",
    include: [
      { model: models.Subject, as: "subject" },
      { model: models.User, as: "teacher" },
    ],
  },
  { model: models.Specialty, as: "department" },
  { model: models.User, as: "classMaster" },
];

// Controller methods
const createClass = catchAsync(async (req, res) => {
  const data = validateClassData(req.body);
  await ensureForeignKeysExist(data);
  await checkClassNameUnique(data.name, data.department_id);

  const created = await ClassModel.create(data);
  await syncClassMasterAssignment(created.id, data.class_master_id);
  await logChanges(tableName, created.id, ChangeTypes.create, req.user);
  appResponder(StatusCodes.CREATED, created, res);
});

const readOneClass = catchAsync(async (req, res) => {
  await CRUDClass.readOne(req.params.id, res, includeDetail);
});

// Total + gender split for the class-detail page's stat cards. A separate
// small query rather than folding into readOneClass's response: the
// Students tab already fetches paginated students itself for `total`
// (pagination.total), this only needs to add the one thing pagination
// can't give it, gender counts, without ever pulling every student row.
const getClassStats = catchAsync(async (req, res) => {
  const classId = req.params.id;
  const rows = await models.Student.findAll({
    where: { class_id: classId },
    attributes: ["sex", [sequelize.fn("COUNT", sequelize.col("sex")), "count"]],
    group: ["sex"],
    raw: true,
  });

  const counts = { male: 0, female: 0 };
  let total = 0;
  for (const row of rows) {
    const n = Number(row.count);
    total += n;
    if (String(row.sex).toUpperCase() === "M") counts.male += n;
    else if (String(row.sex).toUpperCase() === "F") counts.female += n;
  }

  appResponder(StatusCodes.OK, { total_students: total, ...counts }, res);
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
  if (data.class_master_id) {
    await syncClassMasterAssignment(req.params.id, data.class_master_id);
  }
});

const deleteClass = catchAsync(async (req, res) => {
  await CRUDClass.delete(req.params.id, res, req);
});

// ─── Class master, by year ───────────────────────────────────────────
//
// classes.class_master_id is only ever "who's the master right now" —
// class_master_assignments is the real year-scoped record every report
// card and transcript reads. These two endpoints let admins (and, read-
// only, teachers) see and edit that history directly, instead of the
// only path being "edit the class, which silently only ever touches the
// active year" (see syncClassMasterAssignment above).

const getClassMasterHistory = catchAsync(async (req, res) => {
  const rows = await models.ClassMasterAssignment.findAll({
    where: { class_id: req.params.id },
    include: [
      { model: models.User, as: "teacher", attributes: ["id", "name", "username"] },
      { model: models.AcademicYear, as: "academic_year" },
    ],
    order: [[{ model: models.AcademicYear, as: "academic_year" }, "start_date", "ASC"]],
  });
  appResponder(StatusCodes.OK, rows, res);
});

const setClassMasterForYear = catchAsync(async (req, res, next) => {
  const classId = req.params.id;
  const { academic_year_id, teacher_id } = req.body || {};

  if (!academic_year_id || !teacher_id) {
    return next(
      new AppError(
        "academic_year_id and teacher_id are both required",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const [cls, teacher, year] = await Promise.all([
    ClassModel.findByPk(classId),
    TeacherModel.findByPk(teacher_id),
    models.AcademicYear.findByPk(academic_year_id),
  ]);
  if (!cls) return next(new AppError("Class not found", StatusCodes.NOT_FOUND));
  if (!teacher) return next(new AppError("Teacher not found", StatusCodes.NOT_FOUND));
  if (!year) return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));

  // Throws if this year is archived and the caller has no live grant for
  // it — same rule an edit to class_subjects or Marks would enforce.
  await assertYearWritable(academic_year_id);

  const [row] = await models.ClassMasterAssignment.findOrCreate({
    where: { academic_year_id, class_id: classId },
    defaults: { teacher_id },
    skipYearLockCheck: true,
  });
  if (row.teacher_id !== teacher_id) {
    await row.update({ teacher_id }, { skipYearLockCheck: true });
  }

  // Keep the denormalized "current" field in sync only when this write
  // actually targets the active year — an edit made under a grant to an
  // archived year must never change who classes.class_master_id says is
  // the master right now.
  if (year.status === "active" && cls.class_master_id !== teacher_id) {
    await cls.update({ class_master_id: teacher_id });
  }

  const fresh = await models.ClassMasterAssignment.findByPk(row.id, {
    include: [
      { model: models.User, as: "teacher", attributes: ["id", "name", "username"] },
      { model: models.AcademicYear, as: "academic_year" },
    ],
  });
  appResponder(StatusCodes.OK, fresh, res);
});

module.exports = {
  createClass,
  readOneClass,
  readAllClasses,
  updateClass,
  deleteClass,
  validateClassData,
  getClassMasterHistory,
  setClassMasterForYear,
  getClassStats,
};
