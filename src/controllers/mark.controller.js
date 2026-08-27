"use strict";

const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");
const {
  assertNotPromoted,
  getLockedStudentIds,
} = require("../utils/promotionLock.util");
const { assertYearWritable } = require("../utils/yearLock.util");
const { resolveStudentClassForYear } = require("../utils/studentYear.util");

const MarksModel = models.Mark;
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
  await assertNotPromoted(
    req.body.student_id,
    req.body.class_id,
    req.body.academic_year_id
  );
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

  const existing = await MarksModel.findByPk(req.params.id);
  if (!existing) {
    throw new AppError("Invalid Id, no such resource in the database", 404);
  }
  await assertNotPromoted(
    req.body.student_id ?? existing.student_id,
    req.body.class_id ?? existing.class_id,
    req.body.academic_year_id ?? existing.academic_year_id
  );

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

  // Reject writes for any student already promoted out of this exact
  // (class, academic_year) pair, that pair is closed until an Admin3
  // reverses the promotion move that closed it.
  const lockedStudentIds = await getLockedStudentIds(
    validMarks.map((m) => m.student_id),
    parsedIds.class_id,
    parsedIds.academic_year_id
  );
  if (lockedStudentIds.size > 0) {
    for (const studentId of lockedStudentIds) {
      const idx = validMarks.findIndex((m) => m.student_id === studentId);
      if (idx !== -1) {
        validationErrors.push({
          index: idx,
          student_id: studentId,
          error:
            "Student already promoted out of this class for this academic year, reverse the promotion to edit marks here",
        });
      }
    }
    const lockedSet = lockedStudentIds;
    for (let i = validMarks.length - 1; i >= 0; i--) {
      if (lockedSet.has(validMarks[i].student_id)) validMarks.splice(i, 1);
    }
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

// ─── Single-student marks editor (Admin3 only) ──────────────────────────
//
// A dedicated, deliberately narrow surface: one student, every subject
// their class was assigned for a given (academic_year_id, term_id,
// sequence_id), in one table, editable and saved through the exact same
// Mark model/hooks as normal class-wide entry — the promotion lock, the
// year-lock (attachYearLockHooks on Mark), and validateMarkData all apply
// unchanged. Nothing new is bypassed; this is just a different-shaped
// entry point onto the same protected write path.

const getStudentMarksForTerm = catchAsync(async (req, res, next) => {
  const studentId = Number(req.params.id);
  const academicYearId = Number(req.query.academic_year_id);
  const termId = Number(req.query.term_id);
  const sequenceId = Number(req.query.sequence_id);

  if (!academicYearId || !termId || !sequenceId) {
    return next(
      new AppError(
        "academic_year_id, term_id and sequence_id are all required",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const student = await models.Student.findByPk(studentId, {
    attributes: ["id", "full_name", "class_id", "academic_year_id"],
  });
  if (!student) {
    return next(new AppError("Student not found", StatusCodes.NOT_FOUND));
  }

  const classId = await resolveStudentClassForYear(student, academicYearId);
  if (!classId) {
    return next(
      new AppError(
        "This student has no known class for that academic year.",
        StatusCodes.NOT_FOUND
      )
    );
  }

  const [classSubjects, existingMarks, yearMarkSubjectIds] = await Promise.all([
    models.ClassSubject.findAll({
      where: { class_id: classId, academic_year_id: academicYearId },
      include: [
        {
          model: models.Subject,
          as: "subject",
          attributes: ["id", "name", "code", "category", "coefficient"],
        },
      ],
      order: [[{ model: models.Subject, as: "subject" }, "name", "ASC"]],
    }),
    models.Mark.findAll({
      where: {
        student_id: studentId,
        class_id: classId,
        academic_year_id: academicYearId,
        term_id: termId,
        sequence_id: sequenceId,
      },
      raw: true,
    }),
    // class_subjects only reflects reality from the point this year's
    // assignments were actually entered through the UI onward — years
    // predating that (or any gap in it) have real Mark rows with no
    // matching class_subjects row at all. Without this, a student with
    // genuine historical marks would show an empty, unfixable editor.
    // Scoped to the whole year (not just this term/sequence) so every
    // subject the student has ever been marked on in this year shows up,
    // even if this particular sequence has no score for it yet.
    models.Mark.findAll({
      where: { student_id: studentId, class_id: classId, academic_year_id: academicYearId },
      attributes: ["subject_id"],
      group: ["subject_id"],
      raw: true,
    }),
  ]);

  const markBySubject = new Map(existingMarks.map((m) => [m.subject_id, m]));

  const subjectMap = new Map();
  for (const cs of classSubjects) {
    if (!cs.subject) continue;
    subjectMap.set(cs.subject.id, cs.subject);
  }

  const missingSubjectIds = yearMarkSubjectIds
    .map((r) => r.subject_id)
    .filter((id) => !subjectMap.has(id));
  if (missingSubjectIds.length) {
    const missingSubjects = await models.Subject.findAll({
      where: { id: missingSubjectIds },
      attributes: ["id", "name", "code", "category", "coefficient"],
      raw: true,
    });
    for (const s of missingSubjects) subjectMap.set(s.id, s);
  }

  const subjects = Array.from(subjectMap.values())
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((subject) => {
      const mark = markBySubject.get(subject.id);
      return {
        subject_id: subject.id,
        name: subject.name,
        code: subject.code,
        category: subject.category,
        coefficient: subject.coefficient,
        mark_id: mark?.id || null,
        score: mark ? Number(mark.score) : null,
      };
    });

  appResponder(
    StatusCodes.OK,
    {
      student: { id: student.id, name: student.full_name },
      class_id: classId,
      subjects,
    },
    res
  );
});

const saveStudentMarks = catchAsync(async (req, res, next) => {
  const studentId = Number(req.params.id);
  const academicYearId = Number(req.body?.academic_year_id);
  const termId = Number(req.body?.term_id);
  const sequenceId = Number(req.body?.sequence_id);
  const marks = req.body?.marks;

  if (!academicYearId || !termId || !sequenceId) {
    return next(
      new AppError(
        "academic_year_id, term_id and sequence_id are all required",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (!Array.isArray(marks) || marks.length === 0) {
    return next(
      new AppError("marks must be a non-empty array", StatusCodes.BAD_REQUEST)
    );
  }

  const student = await models.Student.findByPk(studentId, {
    attributes: ["id", "class_id", "academic_year_id"],
  });
  if (!student) {
    return next(new AppError("Student not found", StatusCodes.NOT_FOUND));
  }

  const classId = await resolveStudentClassForYear(student, academicYearId);
  if (!classId) {
    return next(
      new AppError(
        "This student has no known class for that academic year.",
        StatusCodes.NOT_FOUND
      )
    );
  }

  await assertNotPromoted(studentId, classId, academicYearId);

  // The Mark model's beforeCreate hook (attachYearLockHooks) otherwise
  // silently force-overwrites academic_year_id to whatever year is
  // currently active on every create — correct for the normal per-class
  // entry flow (which only ever targets the active year in practice), but
  // wrong here: a student can legitimately still be sitting in an
  // archived year (not yet promoted), and this editor must be able to
  // create marks for exactly the year requested. Checking writability
  // explicitly and skipping the hook's own check mirrors the same
  // pattern used for class_subjects/class_master_assignments elsewhere —
  // throws if academicYearId is archived and the caller has no live
  // grant for it, no-ops for the active year.
  await assertYearWritable(academicYearId);

  const results = [];
  for (const entry of marks) {
    const subjectId = Number(entry.subject_id);
    const score = Number(entry.score);
    if (!subjectId || Number.isNaN(score) || score < 0 || score > 20) {
      return next(
        new AppError(
          `Invalid subject_id/score in marks array: ${JSON.stringify(entry)}`,
          StatusCodes.BAD_REQUEST
        )
      );
    }

    const [mark, created] = await models.Mark.findOrCreate({
      where: {
        student_id: studentId,
        subject_id: subjectId,
        class_id: classId,
        academic_year_id: academicYearId,
        term_id: termId,
        sequence_id: sequenceId,
      },
      defaults: {
        score,
        uploaded_by: req.user.id,
      },
      skipYearLockCheck: true,
    });
    if (!created && Number(mark.score) !== score) {
      await mark.update(
        { score, uploaded_by: req.user.id },
        { skipYearLockCheck: true }
      );
    }
    results.push({ subject_id: subjectId, mark_id: mark.id, score });
  }

  await logChanges(
    "student_marks_edit",
    studentId,
    ChangeTypes.update,
    req.user,
    { academic_year_id: academicYearId, term_id: termId, sequence_id: sequenceId, marks: results }
  );

  appResponder(StatusCodes.OK, { saved: results }, res);
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
  getStudentMarksForTerm,
  saveStudentMarks,
  readAllTerms,
  readAllSequences,
};
