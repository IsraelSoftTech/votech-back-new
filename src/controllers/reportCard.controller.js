/* controllers/bulkReportCards.controller.js */
const { Op } = require("sequelize");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const models = require("../models/index.model");
const appResponder = require("../utils/appResponder");
const { StatusCodes } = require("http-status-codes");

const sequences = {
  seq1: { name: "Sequence 1", weight: 1 },
  seq2: { name: "Sequence 2", weight: 1 },
  seq3: { name: "Sequence 3", weight: 1 },
  seq4: { name: "Sequence 4", weight: 1 },
  seq5: { name: "Sequence 5", weight: 1 },
  seq6: { name: "Sequence 6", weight: 1 },
};

const administration = {
  classMaster: "NDICHIA GLIEM",
  principal: "Mr. Thomas Ambe",
  nextTermStarts: "",
  decision: "PROMOTED",
};

const round = (n, d = 1) => Number(n.toFixed(d));

const bulkReportCards = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId } = req.query;

  if (!academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const marks = await models.marks.findAll({
    where: {
      academic_year_id: academicYearId,
      //   department_id: departmentId,
      class_id: classId,
    },
    include: [
      {
        model: models.students,
        as: "student",
        attributes: ["id", "full_name", "student_id", "date_of_birth"],
        include: [
          {
            model: models.Class,
            as: "Class",
            attributes: ["name"],
            include: [
              {
                model: models.specialties,
                as: "department",
                attributes: ["name"],
              },
            ],
          },
        ],
      },
      {
        model: models.Subject,
        as: "subject",
        attributes: ["code", "name", "coefficient", "category"],
        include: [
          {
            model: models.ClassSubject,
            as: "classSubjects",
            attributes: ["id", "class_id"],
            include: [
              {
                model: models.users,
                as: "teacher",
                attributes: ["id", "name", "username"],
              },
            ],
          },
        ],
      },
      { model: models.Term, as: "term", attributes: ["order_number", "name"] },
      {
        model: models.Sequence,
        as: "sequence",
        attributes: ["order_number", "name"],
      },
      { model: models.AcademicYear, as: "academic_year", attributes: ["name"] },
    ],
    order: [
      [{ model: models.students, as: "student" }, "full_name", "ASC"],
      [{ model: models.Subject, as: "subject" }, "code", "ASC"],
      [{ model: models.Term, as: "term" }, "order_number", "ASC"],
      [{ model: models.Sequence, as: "sequence" }, "order_number", "ASC"],
    ],
  });

  if (!marks.length) return next(new AppError("No data found", 404));

  /* 2️ Building a nested map keyed by student id */
  const map = new Map();

  for (const m of marks) {
    const stId = m.student.id;

    // console.log(m.toJSON());

    /* create skeleton once */
    if (!map.has(stId)) {
      map.set(stId, {
        student: {
          id: m.student.id,
          name: m.student.name,
          registrationNumber: m.student.registrationNumber,
          dateOfBirth: m.student.dateOfBirth,
          class: m.student.Class.name,
          option: m.student.Class.department.name,
          academicYear: m.academic_year.name,
          term: `THIRD TERM`, // overall placeholder – not used for ranking
        },
        sequences,
        generalSubjects: [],
        professionalSubjects: [],
        termTotals: { term1: {}, term2: {}, term3: {}, annual: {} },
        classStatistics: {}, // filled later
        conduct: {}, // placeholder
        administration,
      });
    }

    const record = map.get(stId);

    /* locate / create subject */
    let subjectRow;
    const arr =
      m.subject.category === "professional"
        ? record.professionalSubjects
        : record.generalSubjects;

    subjectRow = arr.find((s) => s.code === m.subject.code);
    if (!subjectRow) {
      subjectRow = {
        code: m.subject.code,
        title: m.subject.title,
        coef: m.subject.coef,
        teacher:
          (m.subject.classSubjects.find((el) => el.class_id === m.class_id)
            ?.teacher?.name ||
            m.subject.classSubjects.find((el) => el.class_id === m.class_id)
              ?.teacher?.username) ??
          "N/A",
        scores: {
          seq1: null,
          seq2: null,
          seq3: null,
          seq4: null,
          seq5: null,
          seq6: null,
          term1Avg: null,
          term2Avg: null,
          term3Avg: null,
          finalAvg: null,
        },
      };
      arr.push(subjectRow);
    }

    subjectRow.scores[`seq${m.sequence.order_number}`] = +m.score;
  }

  for (const rec of map.values()) {
    for (const subject of [
      ...rec.generalSubjects,
      ...rec.professionalSubjects,
    ]) {
      const { scores, coef } = subject;

      /* term averages */
      //   scores.term1Avg = round((scores.seq1 + scores.seq2) / 2);
      //   scores.term2Avg = round((scores.seq3 + scores.seq4) / 2);
      //   scores.term3Avg = round((scores.seq5 + scores.seq6) / 2);

      const avg = (...seqs) => {
        const valid = seqs.filter((s) => s != null);
        return valid.length
          ? round(valid.reduce((a, b) => a + b, 0) / valid.length)
          : null;
      };

      scores.term1Avg = avg(scores.seq1, scores.seq2);
      scores.term2Avg = avg(scores.seq3, scores.seq4);
      scores.term3Avg = avg(scores.seq5, scores.seq6);

      /* final weighted average */
      //   const weightedSum =
      //     scores.term1Avg * coef +
      //     scores.term2Avg * coef +
      //     scores.term3Avg * coef;
      //   scores.finalAvg = round(weightedSum / (3 * coef));

      const terms = [scores.term1Avg, scores.term2Avg, scores.term3Avg];
      const validTerms = terms.filter((t) => t != null); // only non-null averages

      const weightedSum = validTerms.reduce((sum, t) => sum + t * coef, 0);
      scores.finalAvg = validTerms.length
        ? round(weightedSum / (validTerms.length * coef))
        : null;
    }
  }

  /* 4️⃣  Build per-term & annual totals + ranks */
  const studentsArray = Array.from(map.values());

  /* helper to compute term total & average */
  const computeTerm = (studentRec, term) => {
    let totalWeighted = 0,
      totalCoef = 0;
    for (const subj of [
      ...studentRec.generalSubjects,
      ...studentRec.professionalSubjects,
    ]) {
      const avg = subj.scores[`term${term}Avg`];
      if (avg !== null) {
        totalWeighted += avg * subj.coef;
        totalCoef += subj.coef;
      }
    }
    const average = totalCoef ? round(totalWeighted / totalCoef) : 0;
    return { total: totalWeighted, average };
  };

  /* fill termTotals for each student */
  studentsArray.forEach((st) => {
    st.termTotals.term1 = computeTerm(st, 1);
    st.termTotals.term2 = computeTerm(st, 2);
    st.termTotals.term3 = computeTerm(st, 3);

    /* annual total & average */
    const annualWeighted =
      st.termTotals.term1.total +
      st.termTotals.term2.total +
      st.termTotals.term3.total;

    const annualCoef =
      [...st.generalSubjects, ...st.professionalSubjects].reduce(
        (sum, s) => sum + s.coef,
        0
      ) * 3;

    st.termTotals.annual = {
      total: annualWeighted,
      average: annualCoef ? round(annualWeighted / annualCoef) : 0,
    };
  });

  /* 5️⃣  Ranks */
  ["term1", "term2", "term3", "annual"].forEach((key) => {
    studentsArray
      .sort((a, b) => b.termTotals[key].average - a.termTotals[key].average)
      .forEach((st, idx) => {
        st.termTotals[key].rank = idx + 1;
        st.termTotals[key].outOf = studentsArray.length;
      });
  });

  /* 6️⃣  classStatistics (simple) */
  const averages = studentsArray.map((s) => s.termTotals.annual.average);
  const classStats = {
    classAverage: round(averages.reduce((a, b) => a + b, 0) / averages.length),
    highestAverage: Math.max(...averages),
    lowestAverage: Math.min(...averages),
  };
  studentsArray.forEach((st) => (st.classStatistics = classStats));

  /* 7️⃣  send */
  appResponder(
    StatusCodes.OK,
    {
      count: studentsArray.length,
      reportCards: studentsArray,
    },
    res
  );
});

const singleReportCard = catchAsync(async (req, res, next) => {
  const { studentId, academicYearId } = req.query;

  if (!studentId) {
    return next(
      new AppError("Missing parameter: studentId", StatusCodes.BAD_REQUEST)
    );
  }

  // Fetch all marks for this student (optionally filter by year)
  const marks = await models.marks.findAll({
    where: {
      student_id: studentId,
      ...(academicYearId && { academic_year_id: academicYearId }),
    },
    include: [
      {
        model: models.students,
        as: "student",
        attributes: ["id", "full_name", "student_id", "date_of_birth"],
        include: [
          {
            model: models.Class,
            as: "Class",
            attributes: ["name"],
            include: [
              {
                model: models.specialties,
                as: "department",
                attributes: ["name"],
              },
            ],
          },
        ],
      },
      {
        model: models.Subject,
        as: "subject",
        attributes: ["code", "name", "coefficient", "category"],
        include: [
          {
            model: models.ClassSubject,
            as: "classSubjects",
            attributes: ["id", "class_id"],
            include: [
              {
                model: models.users,
                as: "teacher",
                attributes: ["id", "name", "username"],
              },
            ],
          },
        ],
      },
      { model: models.Term, as: "term", attributes: ["order_number", "name"] },
      {
        model: models.Sequence,
        as: "sequence",
        attributes: ["order_number", "name"],
      },
      { model: models.AcademicYear, as: "academic_year", attributes: ["name"] },
    ],
    order: [
      [{ model: models.Subject, as: "subject" }, "code", "ASC"],
      [{ model: models.Term, as: "term" }, "order_number", "ASC"],
      [{ model: models.Sequence, as: "sequence" }, "order_number", "ASC"],
    ],
  });

  if (!marks.length) return next(new AppError("No data found", 404));

  // Build student report card
  const m = marks[0]; // all marks belong to this student
  const sequences = {}; // optionally build sequence info
  const administration = {}; // fill as needed

  const reportCard = {
    student: {
      id: m.student.id,
      name: m.student.full_name?.toUpperCase(),
      registrationNumber: m.student.student_id?.toUpperCase(),
      dateOfBirth: m.student.date_of_birth,
      class: m.student.Class.name?.toUpperCase(),
      option: m.student.Class.department.name?.toUpperCase(),
      academicYear: m.academic_year.name?.toUpperCase(),
      term: `THIRD TERM`,
    },
    sequences,
    generalSubjects: [],
    professionalSubjects: [],
    termTotals: { term1: {}, term2: {}, term3: {}, annual: {} },
    classStatistics: {},
    conduct: {},
    administration,
  };

  for (const mark of marks) {
    const arr =
      mark.subject === "professional"
        ? reportCard.professionalSubjects
        : reportCard.generalSubjects;

    let subjectRow = arr.find((s) => s.code === mark.subject.code);
    if (!subjectRow) {
      subjectRow = {
        code: mark.subject.code?.toUpperCase(),
        title: mark.subject.name?.toUpperCase(),
        coef: mark.subject.coefficient,
        teacher:
          mark.subject.classSubjects.find((el) => el.class_id === mark.class_id)
            ?.teacher?.name ||
          mark.subject.classSubjects.find((el) => el.class_id === mark.class_id)
            ?.teacher?.username ||
          "N/A",
        scores: {
          seq1: null,
          seq2: null,
          seq3: null,
          seq4: null,
          seq5: null,
          seq6: null,
          term1Avg: null,
          term2Avg: null,
          term3Avg: null,
          finalAvg: null,
        },
      };
      arr.push(subjectRow);
    }

    subjectRow.scores[`seq${mark.sequence.order_number}`] = +mark.score;
  }

  // Compute term averages and final average
  for (const subject of [
    ...reportCard.generalSubjects,
    ...reportCard.professionalSubjects,
  ]) {
    const { scores, coef } = subject;

    const avg = (...seqs) => {
      const valid = seqs.filter((s) => s != null);
      return valid.length
        ? round(valid.reduce((a, b) => a + b, 0) / valid.length)
        : null;
    };

    scores.term1Avg = avg(scores.seq1, scores.seq2);
    scores.term2Avg = avg(scores.seq3, scores.seq4);
    scores.term3Avg = avg(scores.seq5, scores.seq6);

    const terms = [scores.term1Avg, scores.term2Avg, scores.term3Avg].filter(
      (t) => t != null
    );
    const weightedSum = terms.reduce((sum, t) => sum + t * coef, 0);
    scores.finalAvg = terms.length
      ? round(weightedSum / (terms.length * coef))
      : null;
  }

  appResponder(StatusCodes.OK, { reportCard }, res);
});

module.exports = { bulkReportCards, singleReportCard };
