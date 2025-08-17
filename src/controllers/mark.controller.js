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

// function transformMarks(marks) {
//   const subjectsMap = {};

//   marks.forEach((mark) => {
//     const subjectId = mark.subject.id;

//     if (!subjectsMap[subjectId]) {
//       subjectsMap[subjectId] = {
//         code: mark.subject.code,
//         title: mark.subject.name,
//         coef: mark.subject.coefficient || 1,
//         teacher:
//           mark.class.class_master.name ||
//           mark.class.class_master.username ||
//           "",
//         type: mark.subject.type,
//         scores: {},
//       };
//     }

//     // store sequence score dynamically
//     subjectsMap[subjectId].scores[`seq${mark.sequence.id}`] = Number(
//       mark.score
//     );

//     // store term average if exists
//     if (mark.term && mark.term_average !== undefined) {
//       subjectsMap[subjectId].scores[`term${mark.term.id}Avg`] =
//         mark.term_average;
//     }

//     // store final average if exists
//     if (mark.final_average !== undefined) {
//       subjectsMap[subjectId].scores.finalAvg = mark.final_average;
//     }
//   });

//   return Object.values(subjectsMap);
// }

// function splitSubjectsByType(subjects) {
//   const generalSubjects = [];
//   const professionalSubjects = [];

//   subjects.forEach((subj) => {
//     if (subj.type && subj.type === "general") {
//       generalSubjects.push(subj);
//     } else {
//       professionalSubjects.push(subj);
//     }
//   });

//   return { generalSubjects, professionalSubjects };
// }

// async function getStudentTermTotals(classId, academicYearId) {
//   // 1️⃣ Fetch all marks for the class & academic year, including student & term
//   const marks = await models.marks.findAll({
//     where: { class_id: classId, academic_year_id: academicYearId },
//     include: [
//       {
//         model: models.students,
//         as: "student",
//         attributes: ["id", "full_name"],
//       },
//       { model: models.Term, as: "term", attributes: ["id", "name"] },
//       { model: models.Sequence, as: "sequence", attributes: ["id", "name"] },
//     ],
//     raw: true,
//   });

//   if (!marks.length) return {};

//   // 2️⃣ Aggregate total & average per student per term
//   const termTotalsMap = {}; // { studentId: { termId: { total, average } } }

//   marks.forEach((m) => {
//     const sId = m["student_id"];
//     const tId = m["term_id"];
//     if (!termTotalsMap[sId]) termTotalsMap[sId] = {};
//     if (!termTotalsMap[sId][tId])
//       termTotalsMap[sId][tId] = { total: 0, count: 0, average: 0 };

//     termTotalsMap[sId][tId].total += Number(m.score);
//     termTotalsMap[sId][tId].count += 1;
//     termTotalsMap[sId][tId].average =
//       termTotalsMap[sId][tId].total / termTotalsMap[sId][tId].count;
//   });

//   // 3️⃣ Convert to array format & compute ranks per term
//   const students = [...new Set(marks.map((m) => m["student_id"]))];
//   const terms = [...new Set(marks.map((m) => m["term_id"]))];

//   const termRankings = {};

//   terms.forEach((termId) => {
//     const arr = students.map((studentId) => {
//       const t = termTotalsMap[studentId][termId];
//       return {
//         student_id: studentId,
//         total: t.total,
//         average: Number(t.average.toFixed(2)),
//       };
//     });
//     arr.sort((a, b) => b.total - a.total);
//     arr.forEach((s, index) => {
//       s.rank = index + 1;
//       s.outOf = arr.length;
//     });
//     termRankings[termId] = arr;
//   });

//   // 4️⃣ Compute annual totals per student
//   const annualTotals = students.map((studentId) => {
//     const totals = terms.map((termId) => termTotalsMap[studentId][termId]);
//     const total = totals.reduce((sum, t) => sum + t.total, 0);
//     const average =
//       totals.reduce((sum, t) => sum + t.average, 0) / totals.length;
//     return {
//       student_id: studentId,
//       total,
//       average: Number(average.toFixed(2)),
//     };
//   });

//   // 5️⃣ Build final structured object per student
//   const result = {};
//   students.forEach((studentId) => {
//     result[studentId] = {
//       termTotals: {},
//       annual: annualTotals.find((a) => a.student_id === studentId),
//     };
//     terms.forEach((termId) => {
//       const termData = termRankings[termId].find(
//         (s) => s.student_id === studentId
//       );
//       result[studentId].termTotals[`term${termId}`] = {
//         total: termData.total,
//         average: termData.average,
//         rank: termData.rank,
//         outOf: termData.outOf,
//       };
//     });
//   });

//   return result;
// }

// const getStudentReportCard = catchAsync(async (req, res, next) => {
//   const { term, studentId, academicYearId, classId } = req.params;
//   const sampleData = {
//     // Sequences data structure

//     // Calculated totals and averages
//     termTotals: {
//       term1: { total: 892, average: 15.2, rank: 2, outOf: 25 },
//       term2: { total: 856, average: 14.6, rank: 3, outOf: 25 },
//       term3: { total: 924, average: 15.8, rank: 1, outOf: 25 },
//       annual: { total: 891, average: 15.2, rank: 2, outOf: 25 },
//     },

//     classStatistics: {
//       classAverage: 12.8,
//       highestAverage: 16.2,
//       lowestAverage: 8.4,
//     },

//     conduct: {
//       attendanceDays: 65,
//       totalDays: 68,
//       timesLate: 2,
//       disciplinaryActions: 0,
//     },

//     administration: {
//       classMaster: "NDICHIA GLIEM",
//       principal: "Dr. ACADEMIC DIRECTOR",
//       nextTermStarts: "September 2024",
//       decision: "PROMOTED",
//     },
//   };

//   if (!term) {
//     return new AppError(
//       "Please you must provide the term number in the query parameters",
//       StatusCodes.BAD_REQUEST
//     );
//   }

//   if (!studentId) {
//     return new AppError(
//       "Please you must provide the studen Id as a query paramenter",
//       StatusCodes.BAD_REQUEST
//     );
//   }

//   const reportCartTerm =
//     term === 1 ? "FIRST TERM" : term === 2 ? "SECOND TERM" : "THIRD TERM";
//   const studentInfo = await models.students.finByPk(studentId, {
//     include: [
//       {
//         model: models.Class,
//         as: "class",
//         attributes: ["id", "name"],
//       },
//       {
//         model: models.AcademicYear,
//         as: "AcademicYear",
//         attributes: ["id", "name", "start_date", "end_date"],
//       },
//       {
//         model: models.specialties,
//         as: "department",
//         attributes: ["id", "name"],
//       },
//     ],
//   });

//   if (!studentInfo) {
//     return next(
//       new AppError("No such student Id in the database", StatusCodes.NOT_FOUND)
//     );
//   }

//   const studentdob = new Date(studentInfo.registration_date);

//   const formattedDOB = studentdob.toLocaleDateString("en-GB", {
//     day: "numeric",
//     month: "long",
//     year: "numeric",
//   });

//   const marks = await models.marks.findAll({
//     where: {
//       student_id: studentId,
//       academic_year_id: academicYearId,
//       class_id: classId,
//     },
//     include: [
//       {
//         model: models.students,
//         as: "student",
//         attributes: ["id", "student_id", "full_name", "sex", "date_of_birth"],
//       },
//       {
//         model: models.Subject,
//         as: "subject",
//         attributes: ["id", "name", "code"],
//       },
//       {
//         model: models.Class,
//         as: "class",
//         attributes: ["id", "name"],
//         include: [
//           {
//             model: models.users, // assuming class_master is a user
//             as: "class_master",
//             attributes: ["id", "username", "full_name"],
//           },
//         ],
//       },
//       {
//         model: models.AcademicYear,
//         as: "academic_year",
//         attributes: ["id", "name"],
//       },
//       {
//         model: models.Term,
//         as: "term",
//         attributes: ["id", "name"],
//       },
//       {
//         model: models.Sequence,
//         as: "sequence",
//         attributes: ["id", "name"],
//       },
//     ],
//     order: [["createdAt", "DESC"]],
//   });

//   const reducedMarks = transformMarks(marks);
//   const { generalSubjects, professionalSubjects } = splitSubjects(reducedMarks);

//   //Data objects
//   const student = {
//     name: studentInfo.full_name,
//     registrationNumber: studentInfo.student_id,
//     dateOfBirth: formattedDOB,
//     class: `${studentInfo.class.name}`,
//     option: studentInfo.department.name,
//     academicYear: `${new Date(
//       studentInfo.academicYear.start_date
//     ).getFullYear()} - ${new Date(
//       studentInfo.AcademicYear.end_date
//     ).getFullYear()}`,
//     term: reportCartTerm,
//   };

//   const sequences = {
//     seq1: { name: "Sequence 1", weight: 1 },
//     seq2: { name: "Sequence 2", weight: 1 },
//     seq3: { name: "Sequence 3", weight: 1 },
//     seq4: { name: "Sequence 4", weight: 1 },
//     seq5: { name: "Sequence 5", weight: 1 },
//     seq6: { name: "Sequence 6", weight: 1 },
//   };
// });

const bulkReportCards = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId } = req.params;

  const students = await Marks.findAll({
    include: [
      {
        model: models.students,
        as: "student",
        attributes: ["name", "registrationNumber", "dateOfBirth", "class"],
      },
      {
        model: models.Subject,
        as: "subject",
        attributes: ["code", "title", "coef"],
      },
      { model: models.Term, as: "term", attributes: ["order"] },
      { model: models.Sequence, as: "sequence", attributes: ["name"] },
      { model: models.AcademicYear, as: "academicYear", attributes: ["name"] },
      {
        model: models.students,
        as: "teacher",
        attributes: ["name", "username"],
        where: { id: Sequelize.col("subject.teacher_id") },
      },
    ],
    where: {
      class_id: classId,
      academic_year_id: academicYearId,
      department_id: departmentId,
    },
  });

  const reportCards = {};

  students.forEach((mark) => {
    const studentId = mark.student_id;
    const subjectCode = mark.subject.code;

    if (!reportCards[studentId]) {
      reportCards[studentId] = {
        student: {
          name: mark.student.name,
          registrationNumber: mark.student.registrationNumber,
          dateOfBirth: mark.student.dateOfBirth,
          class: mark.student.class,
          option: mark.student.option,
          academicYear: mark.academicYear.name,
          term: `TERM ${mark.term.order}`,
        },
        sequences: {
          seq1: { name: "Sequence 1", weight: 1 },
          seq2: { name: "Sequence 2", weight: 1 },
          seq3: { name: "Sequence 3", weight: 1 },
          seq4: { name: "Sequence 4", weight: 1 },
          seq5: { name: "Sequence 5", weight: 1 },
          seq6: { name: "Sequence 6", weight: 1 },
        },
        generalSubjects: [],
        professionalSubjects: [],
        termTotals: { term1: {}, term2: {}, term3: {}, annual: {} },
        conduct: {
          /* ... */
        },
        classStatistics: {
          /* ... */
        },
      };
    }

    // Aggregate subject data
    const subject = {
      code: mark.subject.code,
      title: mark.subject.title,
      coef: mark.subject.coef,
      teacher: mark.teacher.name || mark.teacher.username,
      scores: {},
    };

    // Populate sequence scores
    subject.scores[`seq${mark.sequence.order}`] = mark.score;

    // Add subject to report card based on type
    const subjectType = mark.subject.isProfessional
      ? "professionalSubjects"
      : "generalSubjects";
    reportCards[studentId][subjectType].push(subject);
  });

  const studentsWithAnnualTotal = Object.values(reportCards).map((card) => ({
    ...card.student,
    annualTotal: card.termTotals.annual.total,
  }));

  studentsWithAnnualTotal.sort((a, b) => b.annualTotal - a.annualTotal);

  studentsWithAnnualTotal.forEach((student, index) => {
    student.rank = index + 1;
  });
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
