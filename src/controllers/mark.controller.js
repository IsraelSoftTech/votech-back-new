"use strict";

const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");

const MarksModel = models.marks;
const TermsModel = models.Term;
const SequencesModel = models.Sequence;

let CRUDMarks = new CRUD(MarksModel);
let CRUDTerms = new CRUD(TermsModel);
let CRUDSequences = new CRUD(SequencesModel);

async function initMarks() {
  try {
    const tables = await MarksModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(MarksModel.getTableName())) {
      await MarksModel.sync({ force: false });
    }
    CRUDMarks = new CRUD(MarksModel);
  } catch (err) {
    throw err;
  }
}

async function initTerms() {
  try {
    const tables = await TermsModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(TermsModel.getTableName())) {
      await TermsModel.sync({ force: false });
    }
    CRUDTerms = new CRUD(TermsModel);
  } catch (err) {
    throw err;
  }
}

async function initSequence() {
  try {
    const tables = await SequencesModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(SequencesModel.getTableName())) {
      await SequencesModel.sync({ force: false });
    }
    CRUDSequences = new CRUD(SequencesModel);
  } catch (err) {
    throw err;
  }
}

initMarks();
initTerms();
initSequence();

async function validateMarkData(
  data,
  partial = false,
  skipExistenceCheck = false
) {
  const errors = [];
  const fields = [
    "student_id",
    "subject_id",
    "class_id",
    "academic_year_id",
    "term_id",
    "sequence_id",
    "score",
    "uploaded_by",
  ];

  for (const key of fields) {
    if (!partial || key in data) {
      if (data[key] === undefined || data[key] === null) {
        errors.push(`${key} is required`);
      } else if (
        key !== "score" &&
        (!Number.isInteger(data[key]) || data[key] <= 0)
      ) {
        errors.push(`${key} must be a positive integer`);
      } else if (
        key === "score" &&
        (typeof data.score !== "number" || data.score < 0 || data.score > 100)
      ) {
        errors.push(`score must be a number between 0 and 100`);
      }
    }
  }

  if (errors.length) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }

  // Only check for existing mark if not skipping (i.e., not batch upsert)
  if (!partial && !skipExistenceCheck) {
    const existing = await MarksModel.findOne({
      where: {
        student_id: data.student_id,
        subject_id: data.subject_id,
        class_id: data.class_id,
        academic_year_id: data.academic_year_id,
        term_id: data.term_id,
        sequence_id: data.sequence_id,
      },
    });

    if (existing && existing.id !== data.id) {
      throw new AppError(
        "Mark already exists for this student, subject, class, year, term, and sequence",
        StatusCodes.BAD_REQUEST
      );
    }
  }
}

const createMark = catchAsync(async (req, res) => {
  await validateMarkData(req.body);
  await CRUDMarks.create(req.body, res);
});

const readOneMark = catchAsync(async (req, res) => {
  await CRUDMarks.readOne(req.params.id, res);
});

const readAllMarks = catchAsync(async (req, res) => {
  await CRUDMarks.readAll(res, req);
});

const updateMark = catchAsync(async (req, res) => {
  await validateMarkData(req.body, true);
  await CRUDMarks.update(req.params.id, res, req);
});

const deleteMark = catchAsync(async (req, res) => {
  await CRUDMarks.delete(req.params.id, res);
});

const saveMarksBatch = catchAsync(async (req, res, next) => {
  const {
    academic_year_id,
    class_id,
    term_id,
    sequence_id,
    subject_id,
    marks,
    uploaded_by,
  } = req.body;

  if (
    !academic_year_id ||
    !class_id ||
    !term_id ||
    !sequence_id ||
    !subject_id ||
    !Array.isArray(marks) ||
    marks.length === 0
  ) {
    return next(
      new AppError(
        "academic_year_id, class_id, term_id, sequence_id, subject_id, and marks array are required",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const marksToUpsert = [];

  for (const m of marks) {
    const markData = {
      ...m,
      academic_year_id,
      class_id,
      term_id,
      sequence_id,
      subject_id,
      uploaded_by,
      uploaded_at: new Date(),
    };

    // Skip existence check for batch upserts
    await validateMarkData(markData, false, true);

    marksToUpsert.push(markData);
  }

  // Upsert all marks in parallel targeting the unique constraint
  await Promise.all(
    marksToUpsert.map((mark) =>
      MarksModel.upsert(mark, {
        conflictFields: [
          "student_id",
          "subject_id",
          "class_id",
          "academic_year_id",
          "term_id",
          "sequence_id",
        ],
      })
    )
  );

  const data = await MarksModel.findAll();

  return appResponder(
    StatusCodes.OK,
    { status: "success", message: "Marks saved successfully", data },
    res
  );
});

const readAllTerms = catchAsync(async (req, res) => {
  await CRUDTerms.readAll(res, req);
});

const readAllSequences = catchAsync(async (req, res) => {
  await CRUDSequences.readAll(res, req);
});

module.exports = {
  initMarks,
  createMark,
  readOneMark,
  readAllMarks,
  updateMark,
  deleteMark,
  validateMarkData,
  saveMarksBatch,
  readAllTerms,
  readAllSequences,
};
