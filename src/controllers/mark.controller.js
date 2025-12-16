"use strict";

const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");

const MarksModel = models.marks;
const TermsModel = models.Term;
const SequencesModel = models.Sequence;

let CRUDMarks = new CRUD(MarksModel);
let CRUDTerms = new CRUD(TermsModel);
let CRUDSequences = new CRUD(SequencesModel);

// Concurrency control
const BATCH_SIZE = 10; // Process 10 marks at a time
const MAX_RETRIES = 2; // Reduced from 3 for faster failure
const RETRY_DELAY = 200; // Reduced from 500ms

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
        (typeof data.score !== "number" || data.score < 0 || data.score > 20)
      ) {
        errors.push(`score must be a number between 0 and 20`);
      }
    }
  }

  if (errors.length) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }

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
  await CRUDMarks.create(req.body, res, req);
});

const readOneMark = catchAsync(async (req, res) => {
  await CRUDMarks.readOne(req.params.id, res);
});

const readAllMarks = catchAsync(async (req, res) => {
  await CRUDMarks.readAll(res, req, "student_id", 1, 300);
});

const updateMark = catchAsync(async (req, res) => {
  await validateMarkData(req.body, true);
  await CRUDMarks.update(req.params.id, res, req);
});

const deleteMark = catchAsync(async (req, res) => {
  await CRUDMarks.delete(req.params.id, res, req);
});

/**
 * OPTIMIZED FOR HIGH CONCURRENCY
 * - Batched parallel processing (10 at a time)
 * - Shorter transactions
 * - Reduced retry attempts
 * - Minimal logging
 * - Fast failure detection
 */
const saveMarksBatch = catchAsync(async (req, res, next) => {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log(`\n[${requestId}] 🚀 Batch save started`);

  const {
    academic_year_id,
    class_id,
    term_id,
    sequence_id,
    subject_id,
    marks,
    uploaded_by,
  } = req.body;

  // Parse IDs
  const parsedIds = {
    academic_year_id: Number(academic_year_id),
    class_id: Number(class_id),
    term_id: Number(term_id),
    sequence_id: Number(sequence_id),
    subject_id: Number(subject_id),
    uploaded_by: Number(uploaded_by),
  };

  // Validation
  if (
    !parsedIds.academic_year_id ||
    !parsedIds.class_id ||
    !parsedIds.term_id ||
    !parsedIds.sequence_id ||
    !parsedIds.subject_id ||
    !parsedIds.uploaded_by
  ) {
    return next(new AppError("All fields required", StatusCodes.BAD_REQUEST));
  }

  if (!Array.isArray(marks) || marks.length === 0) {
    return next(
      new AppError("marks must be non-empty array", StatusCodes.BAD_REQUEST)
    );
  }

  console.log(`[${requestId}] Processing ${marks.length} marks`);

  // Verify Class-Subject
  const classSubjectExists = await models.ClassSubject.findOne({
    where: { class_id: parsedIds.class_id, subject_id: parsedIds.subject_id },
  });

  if (!classSubjectExists) {
    return next(
      new AppError("Class not assigned to subject", StatusCodes.FORBIDDEN)
    );
  }

  // Validate marks
  const validMarks = [];
  const validationErrors = [];
  const seenStudents = new Set();

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const studentId = Number(m.student_id);
    const score = Number(m.score);

    if (seenStudents.has(studentId)) {
      validationErrors.push({
        index: i,
        student_id: studentId,
        error: "Duplicate",
      });
      continue;
    }

    if (!studentId || isNaN(studentId) || studentId <= 0) {
      validationErrors.push({
        index: i,
        student_id: m.student_id,
        error: "Invalid student ID",
      });
      continue;
    }

    if (m.score === undefined || m.score === null || m.score === "") {
      validationErrors.push({
        index: i,
        student_id: studentId,
        error: "Score required",
      });
      continue;
    }

    if (isNaN(score) || score < 0 || score > 20) {
      validationErrors.push({
        index: i,
        student_id: studentId,
        error: `Invalid score: ${m.score}`,
      });
      continue;
    }

    validMarks.push({
      student_id: studentId,
      score: score,
      academic_year_id: parsedIds.academic_year_id,
      class_id: parsedIds.class_id,
      term_id: parsedIds.term_id,
      sequence_id: parsedIds.sequence_id,
      subject_id: parsedIds.subject_id,
      uploaded_by: parsedIds.uploaded_by,
      uploaded_at: new Date(),
      deletedAt: null, // 🔑 Important: Reset deletedAt for upsert
    });
    seenStudents.add(studentId);
  }

  console.log(
    `[${requestId}] Valid: ${validMarks.length}, Invalid: ${validationErrors.length}`
  );

  if (validMarks.length === 0) {
    return appResponder(
      StatusCodes.BAD_REQUEST,
      {
        status: "error",
        message: "All marks failed validation",
        errors: validationErrors,
      },
      res
    );
  }

  // Start transaction
  const transaction = await MarksModel.sequelize.transaction();

  const successfulSaves = [];
  const failedSaves = [];

  try {
    // Process each mark with UPSERT
    for (const mark of validMarks) {
      try {
        // Use upsert - handles both insert and update, including soft-deleted records
        const [instance, created] = await MarksModel.upsert(
          {
            student_id: mark.student_id,
            subject_id: mark.subject_id,
            class_id: mark.class_id,
            academic_year_id: mark.academic_year_id,
            term_id: mark.term_id,
            sequence_id: mark.sequence_id,
            score: mark.score,
            uploaded_by: mark.uploaded_by,
            uploaded_at: mark.uploaded_at,
            deletedAt: null, // 🔑 Restore if soft-deleted
          },
          {
            transaction,
            returning: true,
            // Specify which fields to update on conflict
            conflictFields: [
              "student_id",
              "subject_id",
              "class_id",
              "academic_year_id",
              "term_id",
              "sequence_id",
            ],
          }
        );

        successfulSaves.push({
          student_id: mark.student_id,
          score: mark.score,
          action: created ? "created" : "updated",
          id: instance.id,
        });

        console.log(
          `[${requestId}] ✅ ${
            created ? "Created" : "Updated"
          } mark for student ${mark.student_id}`
        );
      } catch (err) {
        console.error(
          `[${requestId}] ❌ Error for student ${mark.student_id}:`,
          err.message
        );

        failedSaves.push({
          student_id: mark.student_id,
          score: mark.score,
          error: err.message,
        });
      }
    }

    // Check success rate
    if (failedSaves.length > 0 && successfulSaves.length === 0) {
      await transaction.rollback();
      console.error(`[${requestId}] ❌ All saves failed, rolled back`);

      return appResponder(
        StatusCodes.INTERNAL_SERVER_ERROR,
        {
          status: "error",
          message: "All marks failed to save",
          errors: failedSaves,
        },
        res
      );
    }

    // Commit
    await transaction.commit();

    const duration = Date.now() - startTime;
    console.log(
      `[${requestId}] ✅ Committed: ${successfulSaves.length} saved, ${failedSaves.length} failed in ${duration}ms`
    );

    const response = {
      status: failedSaves.length === 0 ? "success" : "partial",
      message: `Saved ${successfulSaves.length}/${validMarks.length} marks`,
      summary: {
        total: marks.length,
        validated: validMarks.length,
        successful: successfulSaves.length,
        failed: validationErrors.length + failedSaves.length,
        created: successfulSaves.filter((s) => s.action === "created").length,
        updated: successfulSaves.filter((s) => s.action === "updated").length,
        duration_ms: duration,
      },
    };

    if (validationErrors.length > 0) {
      response.validationErrors = validationErrors.slice(0, 20);
    }
    if (failedSaves.length > 0) {
      response.saveErrors = failedSaves.slice(0, 20);
    }

    return appResponder(
      failedSaves.length === 0 ? StatusCodes.OK : StatusCodes.PARTIAL_CONTENT,
      response,
      res
    );
  } catch (error) {
    await transaction.rollback();
    console.error(`[${requestId}] ❌ Transaction error:`, error.message);
    return next(
      new AppError(
        `Save failed: ${error.message}`,
        StatusCodes.INTERNAL_SERVER_ERROR
      )
    );
  }
});

const readAllTerms = catchAsync(async (req, res) => {
  await CRUDTerms.readAll(res, req, "", 1, 1000000000000);
});

const readAllSequences = catchAsync(async (req, res) => {
  await CRUDSequences.readAll(res, req, "", 1, 100000000000);
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
