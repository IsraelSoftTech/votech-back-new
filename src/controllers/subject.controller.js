const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");

const SubjectModel = models.Subject;
const ClassSubjectModel = models.ClassSubject;
const ClassModel = models.Class;
const TeacherModel = models.Teacher;

const tableName = SubjectModel.getTableName();

let CRUDSubject = new CRUD(models.Subject);

async function initSubject() {
  try {
    const tables = await SubjectModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(tableName)) {
      await SubjectModel.sync({ force: false });
    }
    CRUDSubject = new CRUD(models.Subject);
  } catch (err) {
    throw err;
  }
}

initSubject();

function validateSubjectData(data, partial = false) {
  const errors = [];

  if (data.name && typeof data.name === "string") data.name = data.name.trim();
  if (data.code && typeof data.code === "string") data.code = data.code.trim();

  if (!partial || "name" in data) {
    if (!data.name || typeof data.name !== "string" || data.name.length < 2) {
      errors.push("Name is required and must be at least 2 characters");
    }
  }

  if ("code" in data && data.code !== undefined && data.code !== null) {
    if (typeof data.code !== "string" || data.code.length < 2) {
      errors.push("Code must be at least 2 characters if provided");
    } else if (!/^[A-Z0-9\-]+$/i.test(data.code)) {
      errors.push("Code can only contain letters, numbers, and dashes");
    }
  }

  if (!partial || "coefficient" in data) {
    if (
      data.coefficient === undefined ||
      !Number.isInteger(data.coefficient) ||
      data.coefficient < 1 ||
      data.coefficient > 20
    ) {
      errors.push("Coefficient must be an integer between 1 and 20");
    }
  }

  if (!partial || "category" in data) {
    if (!["general", "professional"].includes(data.category)) {
      errors.push("Category must be either 'general' or 'professional'");
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }
}

// Include nested associations correctly using association names
const include = [
  {
    association: SubjectModel.associations.classSubjects,
    include: [
      { association: ClassSubjectModel.associations.class },
      { association: ClassSubjectModel.associations.teacher },
      { association: ClassSubjectModel.associations.department },
    ],
  },
];

// Controller methods

const createSubject = catchAsync(async (req, res, next) => {
  validateSubjectData(req.body);
  await CRUDSubject.create(req.body, res);
});

const readOneSubject = catchAsync(async (req, res, next) => {
  await CRUDSubject.readOne(req.params.id, res, { include });
});

const readAllSubjects = catchAsync(async (req, res, next) => {
  await CRUDSubject.readAll(res, req, "", 1, 100, include);
});

const updateSubject = catchAsync(async (req, res, next) => {
  validateSubjectData(req.body, true);
  await CRUDSubject.update(req.params.id, res, req);
});

const deleteSubject = catchAsync(async (req, res, next) => {
  await CRUDSubject.delete(req.params.id, res);
});

module.exports = {
  initSubject,
  createSubject,
  readOneSubject,
  readAllSubjects,
  updateSubject,
  deleteSubject,
  validateSubjectData,
};
