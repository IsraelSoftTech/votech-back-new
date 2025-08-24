/* controllers/bulkReportCards.controller.js */
const { Op, where } = require("sequelize");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const models = require("../models/index.model");
const appResponder = require("../utils/appResponder");
const { StatusCodes } = require("http-status-codes");

const sequencesFormat = {
  seq1: { name: "Sequence 1", weight: 1 },
  seq2: { name: "Sequence 2", weight: 1 },
  seq3: { name: "Sequence 3", weight: 1 },
  seq4: { name: "Sequence 4", weight: 1 },
  seq5: { name: "Sequence 5", weight: 1 },
  seq6: { name: "Sequence 6", weight: 1 },
};

const administrationFormat = {
  classMaster: "NDICHIA GLIEM",
  principal: "Mr. Thomas Ambe",
  nextTermStarts: "",
  decision: "",
};

const round = (n, d = 1) => Number(n.toFixed(d));

// Shared builder: builds report cards and computes per-term + annual totals, ranks, and class stats
function buildReportCardsFromMarks(marks, classMaster) {
  // placeholders (keep them identical to bulk)
  const sequences = { ...sequencesFormat };
  const administration = { ...administrationFormat, classMaster };

  const map = new Map();

  for (const m of marks) {
    const stId = m?.student?.id;
    if (!stId) continue;

    // const student = await models.students.findByPk(stId);

    // let parents = [];

    // if (student?.father_name) parents.push(student.father_name);
    // if (student?.mother_name) parents.push(student.mother_name);

    // administration.parents = parents.length > 0 ? parents.join(", ") : "N/A";

    // administration.parents = parents.join(", ");

    // Create the student skeleton once
    if (!map.has(stId)) {
      map.set(stId, {
        student: {
          id: m.student.id,
          name: m.student.full_name, // fixed to match selected attributes
          registrationNumber: m.student.student_id,
          dateOfBirth: m.student.date_of_birth,
          class: m.student.Class?.name,
          option: m.student.Class?.department?.name,
          academicYear: m.academic_year?.name,
          term: "THIRD TERM", // overall placeholder – not used for ranking
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

    // Locate/create subject row
    const arr =
      m.subject?.category === "professional"
        ? record.professionalSubjects
        : record.generalSubjects;

    let subjectRow = arr.find((s) => s.code === m.subject.code);
    if (!subjectRow) {
      subjectRow = {
        code: m.subject.code,
        title: m.subject.name, // fixed name/title mismatch
        coef: m.subject.coefficient, // fixed coefficient naming
        teacher:
          m.subject.classSubjects?.find((el) => el.class_id === m.class_id)
            ?.teacher?.name ||
          m.subject.classSubjects?.find((el) => el.class_id === m.class_id)
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

    // Fill sequence score
    if (m.sequence?.order_number) {
      subjectRow.scores[`seq${m.sequence.order_number}`] = +m.score;
    }
  }

  // Compute per-subject term averages and final average
  for (const rec of map.values()) {
    for (const subject of [
      ...rec.generalSubjects,
      ...rec.professionalSubjects,
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

      const terms = [scores.term1Avg, scores.term2Avg, scores.term3Avg];
      const validTerms = terms.filter((t) => t != null);

      const weightedSum = validTerms.reduce((sum, t) => sum + t * coef, 0);
      scores.finalAvg = validTerms.length
        ? round(weightedSum / (validTerms.length * coef))
        : null;
    }
  }

  // Build per-term & annual totals + ranks
  const studentsArray = Array.from(map.values());

  const computeTerm = (studentRec, term) => {
    let totalWeighted = 0;
    let totalCoef = 0;

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

  // Term totals
  studentsArray.forEach((st) => {
    st.termTotals.term1 = computeTerm(st, 1);
    st.termTotals.term2 = computeTerm(st, 2);
    st.termTotals.term3 = computeTerm(st, 3);

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

  // Ranks per term and annual
  ["term1", "term2", "term3", "annual"].forEach((key) => {
    studentsArray
      .sort((a, b) => b.termTotals[key].average - a.termTotals[key].average)
      .forEach((st, idx) => {
        st.termTotals[key].rank = idx + 1;
        st.termTotals[key].outOf = studentsArray.length;
      });
  });

  // Class stats (based on annual average)
  const averages = studentsArray.map((s) => s.termTotals.annual.average);
  const classStats = {
    classAverage: round(averages.reduce((a, b) => a + b, 0) / averages.length),
    highestAverage: Math.max(...averages),
    lowestAverage: Math.min(...averages),
  };
  studentsArray.forEach((st) => (st.classStatistics = classStats));

  return studentsArray;
}

// BULK — unchanged behavior, but now uses the shared builder for consistency
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

  const reportCardClass = await models.Class.findByPk(classId, {
    include: [
      {
        model: models.users,
        as: "classMaster",
        attributes: ["name", "username"],
      },
    ],
  });

  const classMaster =
    reportCardClass?.classMaster?.name ||
    reportCardClass?.classMaster?.username ||
    "";

  const marks = await models.marks.findAll({
    where: {
      academic_year_id: academicYearId,
      // department_id: departmentId, // keep parity with your current bulk filter
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

  const reportCards = await buildReportCardsFromMarks(marks, classMaster);

  appResponder(
    StatusCodes.OK,
    {
      count: reportCards.length,
      reportCards,
    },
    res
  );
});

// SINGLE — identical pipeline as bulk, then return only the requested student's card
const singleReportCard = catchAsync(async (req, res, next) => {
  const { studentId, academicYearId, departmentId, classId } = req.query;

  if (!studentId || !academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: studentId=${studentId}, academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Build the full class report using the exact same query and logic as bulk
  const marks = await models.marks.findAll({
    where: {
      academic_year_id: academicYearId,
      // department_id: departmentId, // keep parity with your current bulk filter
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

  // console.log(marks.map((el) => el.toJSON()));

  const reportCardClass = await models.Class.findByPk(classId, {
    include: [
      {
        model: models.users,
        as: "classMaster",
        attributes: ["name", "username"],
      },
    ],
  });

  const classMaster =
    reportCardClass?.classMaster?.name ||
    reportCardClass?.classMaster?.username ||
    "";

  const reportCards = await buildReportCardsFromMarks(marks, classMaster);

  const reportCard = reportCards.find(
    (rc) => String(rc.student.id) === String(studentId)
  );

  if (!reportCard) {
    return next(
      new AppError(
        "Student not found in the provided class/academic year (or has no marks).",
        StatusCodes.NOT_FOUND
      )
    );
  }

  appResponder(StatusCodes.OK, { reportCard }, res);
});

module.exports = { bulkReportCards, singleReportCard };
