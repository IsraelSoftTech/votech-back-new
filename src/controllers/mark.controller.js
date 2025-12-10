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

  // Step 1: Quick Validation
  if (
    !academic_year_id ||
    !class_id ||
    !term_id ||
    !sequence_id ||
    !subject_id ||
    !uploaded_by
  ) {
    console.error(`[${requestId}] ❌ Missing required fields`);
    return next(new AppError("All fields required", StatusCodes.BAD_REQUEST));
  }

  if (!Array.isArray(marks) || marks.length === 0) {
    console.error(`[${requestId}] ❌ Invalid marks array`);
    return next(
      new AppError("marks must be non-empty array", StatusCodes.BAD_REQUEST)
    );
  }

  if (marks.length > 1000) {
    console.error(`[${requestId}] ❌ Batch too large: ${marks.length}`);
    return next(
      new AppError("Max 1000 marks per request", StatusCodes.BAD_REQUEST)
    );
  }

  console.log(`[${requestId}] Processing ${marks.length} marks`);

  // Step 2: Verify Class-Subject (cached in production)
  const classSubjectExists = await models.ClassSubject.findOne({
    where: { class_id, subject_id },
  });

  if (!classSubjectExists) {
    console.error(`[${requestId}] ❌ Class-Subject not assigned`);
    return next(
      new AppError("Class not assigned to subject", StatusCodes.FORBIDDEN)
    );
  }

  // Step 3: Validate All Marks
  const validMarks = [];
  const validationErrors = [];
  const seenStudents = new Set();

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    try {
      if (seenStudents.has(m.student_id)) {
        validationErrors.push({
          index: i,
          student_id: m.student_id,
          error: "Duplicate",
        });
        continue;
      }

      if (!m.student_id || !Number.isInteger(m.student_id)) {
        validationErrors.push({
          index: i,
          student_id: m.student_id,
          error: "Invalid ID",
        });
        continue;
      }

      if (
        m.score === undefined ||
        m.score === null ||
        typeof m.score !== "number"
      ) {
        validationErrors.push({
          index: i,
          student_id: m.student_id,
          error: "Score required",
        });
        continue;
      }

      const score = Number(m.score);
      if (isNaN(score) || score < 0 || score > 20) {
        validationErrors.push({
          index: i,
          student_id: m.student_id,
          error: `Invalid score: ${m.score}`,
        });
        continue;
      }

      const markData = {
        student_id: m.student_id,
        score,
        academic_year_id,
        class_id,
        term_id,
        sequence_id,
        subject_id,
        uploaded_by,
        uploaded_at: new Date(),
      };

      await validateMarkData(markData, false, true);
      validMarks.push(markData);
      seenStudents.add(m.student_id);
    } catch (error) {
      validationErrors.push({
        index: i,
        student_id: m.student_id,
        error: error.message,
      });
    }
  }

  if (validMarks.length === 0) {
    console.error(`[${requestId}] ❌ No valid marks`);
    return appResponder(
      StatusCodes.BAD_REQUEST,
      {
        status: "error",
        message: "All marks failed validation",
        errors: validationErrors.slice(0, 20),
      },
      res
    );
  }

  console.log(
    `[${requestId}] ${validMarks.length} valid, ${validationErrors.length} invalid`
  );

  // Step 4: Start Transaction
  const transaction = await MarksModel.sequelize.transaction();

  try {
    const studentIds = validMarks.map((m) => m.student_id);

    // Step 5: Fetch Existing Marks
    const existingMarks = await MarksModel.findAll({
      where: {
        student_id: studentIds,
        subject_id,
        class_id,
        academic_year_id,
        term_id,
        sequence_id,
      },
      transaction,
    });

    const existingMap = new Map();
    existingMarks.forEach((e) => existingMap.set(e.student_id, e.toJSON()));

    // Step 6: BATCHED PARALLEL PROCESSING
    const successfulSaves = [];
    const failedSaves = [];
    const created = [];
    const updated = [];

    // Process in batches of 10 to avoid overwhelming the database
    for (
      let batchStart = 0;
      batchStart < validMarks.length;
      batchStart += BATCH_SIZE
    ) {
      const batch = validMarks.slice(batchStart, batchStart + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (mark) => {
          const existingMark = existingMap.get(mark.student_id);
          const isUpdate = !!existingMark;
          let lastError = null;

          // Retry logic
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              let savedId;

              if (isUpdate) {
                const [rows] = await MarksModel.update(
                  {
                    score: Number(mark.score),
                    uploaded_by: mark.uploaded_by,
                    uploaded_at: mark.uploaded_at,
                  },
                  { where: { id: existingMark.id }, transaction }
                );
                if (rows === 0) throw new Error("Update affected 0 rows");
                savedId = existingMark.id;
              } else {
                const markToCreate = { ...mark, score: Number(mark.score) };
                const newMark = await MarksModel.create(markToCreate, {
                  transaction,
                });
                savedId = newMark.id;
              }

              // Quick verification
              const verify = await MarksModel.findByPk(savedId, {
                transaction,
              });
              if (!verify) throw new Error("Verification failed");
              if (Number(verify.score) !== Number(mark.score)) {
                throw new Error(
                  `Score mismatch: ${verify.score} vs ${mark.score}`
                );
              }

              return {
                success: true,
                student_id: mark.student_id,
                score: mark.score,
                action: isUpdate ? "updated" : "created",
                id: savedId,
                existingMark: isUpdate ? existingMark : null,
              };
            } catch (err) {
              lastError = err;
              if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, RETRY_DELAY));
              }
            }
          }

          return {
            success: false,
            student_id: mark.student_id,
            error: lastError?.message || "Unknown error",
          };
        })
      );

      // Process batch results
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value.success) {
          const val = result.value;
          successfulSaves.push({
            student_id: val.student_id,
            score: val.score,
            action: val.action,
            id: val.id,
          });

          if (val.action === "created") {
            created.push(val.student_id);
          } else {
            updated.push(val.student_id);
          }

          // Async logging (don't wait)
          if (
            val.action === "updated" &&
            val.existingMark &&
            val.existingMark.score !== val.score
          ) {
            logChanges("marks", val.id, ChangeTypes.update, req.user, {
              score: { before: val.existingMark.score, after: val.score },
            }).catch((err) =>
              console.warn(`[${requestId}] Log error: ${err.message}`)
            );
          } else if (val.action === "created") {
            logChanges("marks", val.id, ChangeTypes.create, req.user, {
              student_id: val.student_id,
              score: val.score,
            }).catch((err) =>
              console.warn(`[${requestId}] Log error: ${err.message}`)
            );
          }
        } else if (result.status === "fulfilled" && !result.value.success) {
          failedSaves.push({
            student_id: result.value.student_id,
            error: result.value.error,
          });
        } else if (result.status === "rejected") {
          failedSaves.push({
            student_id: "unknown",
            error: result.reason?.message || "Promise rejected",
          });
        }
      }
    }

    const successRate = successfulSaves.length / validMarks.length;

    // Step 7: Commit or Rollback
    if (successRate < 0.9 && failedSaves.length > 0) {
      await transaction.rollback();
      console.error(
        `[${requestId}] ❌ Rolled back: ${(successRate * 100).toFixed(
          1
        )}% success`
      );

      return appResponder(
        StatusCodes.INTERNAL_SERVER_ERROR,
        {
          status: "error",
          message: `Too many failures (${failedSaves.length}/${validMarks.length}). Rolled back.`,
          saveErrors: failedSaves.slice(0, 20),
        },
        res
      );
    }

    await transaction.commit();

    const duration = Date.now() - startTime;
    console.log(
      `[${requestId}] ✅ Success: ${successfulSaves.length}/${validMarks.length} in ${duration}ms (${created.length} created, ${updated.length} updated)`
    );

    // Step 8: Final verification (outside transaction)
    const finalMarks = await MarksModel.findAll({
      where: { subject_id, class_id, academic_year_id, term_id, sequence_id },
      order: [["student_id", "ASC"]],
    });

    const summary = {
      total: marks.length,
      validated: validMarks.length,
      successful: successfulSaves.length,
      failed: validationErrors.length + failedSaves.length,
      created: created.length,
      updated: updated.length,
      duration_ms: duration,
    };

    const response = {
      status: "success",
      message: `Marks saved: ${summary.successful}/${summary.total}`,
      data: finalMarks,
      summary,
    };

    if (validationErrors.length > 0)
      response.validationErrors = validationErrors.slice(0, 20);
    if (failedSaves.length > 0) response.saveErrors = failedSaves.slice(0, 20);

    return appResponder(
      successfulSaves.length === validMarks.length
        ? StatusCodes.OK
        : StatusCodes.PARTIAL_CONTENT,
      response,
      res
    );
  } catch (error) {
    await transaction.rollback();
    const duration = Date.now() - startTime;
    console.error(
      `[${requestId}] ❌ Error after ${duration}ms:`,
      error.message
    );

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
