/* controllers/bulkReportCards.controller.js */
const { Op, where } = require("sequelize");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const models = require("../models/index.model");
const appResponder = require("../utils/appResponder");
const { StatusCodes } = require("http-status-codes");
const puppeteer = require("puppeteer");

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
  parents: "John Snwo",
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
        administration: {
          ...administration,
          parents:
            [m.student?.father_name, m.student?.mother_name]
              .filter(Boolean)
              .join(", ") || "N/A",
        },
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

  const academicYearData = await models.AcademicYear.findByPk(academicYearId);
  if (!academicYearData) {
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  }

  const department = await models.specialties.findByPk(departmentId);
  if (!department) {
    return next(new AppError("Department not found", StatusCodes.NOT_FOUND));
  }

  const studentClass = await models.Class.findByPk(classId);
  if (!studentClass) {
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));
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

  if (!marks.length)
    return next(
      new AppError(
        `No marks available for ${studentClass.name} in ${department.name} (${academicYearData.name}).`,
        404
      )
    );

  const reportCards = buildReportCardsFromMarks(marks, classMaster);

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

// Map query term -> internal key
function selectedTermKey(term = "annual") {
  const t = String(term || "").toLowerCase();
  if (t.includes("term1") || t.includes("first")) return "term1";
  if (t.includes("term2") || t.includes("second")) return "term2";
  if (t.includes("term3") || t.includes("third")) return "term3";
  return "annual";
}

// Build columns for selected term
function getColumnsForTerm(termKey) {
  if (termKey === "term1") {
    return [
      { key: "seq1", label: "SEQ 1" },
      { key: "seq2", label: "SEQ 2" },
      { key: "term1Avg", label: "TERM AVG" },
    ];
  }
  if (termKey === "term2") {
    return [
      { key: "seq3", label: "SEQ 3" },
      { key: "seq4", label: "SEQ 4" },
      { key: "term2Avg", label: "TERM AVG" },
      { key: "term1Avg", label: "T1 AVG" },
      { key: "yearAvg", label: "TOTAL AVG" }, // (T1+T2)/2
    ];
  }
  if (termKey === "term3") {
    return [
      { key: "seq5", label: "SEQ 5" },
      { key: "seq6", label: "SEQ 6" },
      { key: "term3Avg", label: "TERM AVG" },
      { key: "term1Avg", label: "T1 AVG" },
      { key: "term2Avg", label: "T2 AVG" },
      { key: "finalAvg", label: "FINAL AVG" },
    ];
  }
  // annual
  return [
    { key: "seq1", label: "S1" },
    { key: "seq2", label: "S2" },
    { key: "term1Avg", label: "T1 AVG" },
    { key: "seq3", label: "S3" },
    { key: "seq4", label: "S4" },
    { key: "term2Avg", label: "T2 AVG" },
    { key: "seq5", label: "S5" },
    { key: "seq6", label: "S6" },
    { key: "term3Avg", label: "T3 AVG" },
    { key: "finalAvg", label: "FINAL AVG" },
  ];
}

// function round(n, d = 1) {
//   const v = Number(n);
//   if (!Number.isFinite(v)) return "";
//   return Number(v.toFixed(d));
// }
function isNum(n) {
  return typeof n === "number" && !Number.isNaN(n);
}
function avg(values = []) {
  const arr = (values || []).map(Number).filter((x) => !Number.isNaN(x));
  if (!arr.length) return "";
  return round(arr.reduce((a, b) => a + b, 0) / arr.length, 1);
}

const defaultGrading = [
  {
    band_min: 18,
    band_max: 20,
    comment: "Excellent",
    remarkClass: "remark-excellent",
  },
  {
    band_min: 16,
    band_max: 17.99,
    comment: "V.Good",
    remarkClass: "remark-vgood",
  },
  {
    band_min: 14,
    band_max: 15.99,
    comment: "Good",
    remarkClass: "remark-good",
  },
  {
    band_min: 12,
    band_max: 13.99,
    comment: "Fairly Good",
    remarkClass: "remark-fairly-good",
  },
  {
    band_min: 10,
    band_max: 11.99,
    comment: "Average",
    remarkClass: "remark-average",
  },
  { band_min: 0, band_max: 9.99, comment: "Weak", remarkClass: "remark-weak" },
];

function remarkForAverage(n, grading = defaultGrading) {
  const v = Number(n);
  if (Number.isNaN(v)) return { remark: "", remarkClass: "" };

  // Pick the grading band that matches
  const band = grading.find((g) => v >= g.band_min && v <= g.band_max);

  if (!band) return { remark: "No Remark", remarkClass: "" };

  // Find the *matching* default band to get its class
  const defaultBand = defaultGrading.find(
    (g) => v >= g.band_min && v <= g.band_max
  );

  return {
    remark: band.comment, // from custom grading
    remarkClass: defaultBand ? defaultBand.remarkClass : "",
  };
}

// Compute class stats for the selected term
function computeClassStatsForTerm(cards = [], termKey) {
  const values = cards
    .map((rc) => {
      if (termKey === "term1") return Number(rc.termTotals?.term1?.average);
      if (termKey === "term2") return Number(rc.termTotals?.term2?.average);
      if (termKey === "term3") return Number(rc.termTotals?.term3?.average);
      return Number(rc.termTotals?.annual?.average);
    })
    .filter((v) => isNum(v));
  if (!values.length)
    return { classAverage: "", highestAverage: "", lowestAverage: "" };

  return {
    classAverage: round(values.reduce((a, b) => a + b, 0) / values.length, 1),
    highestAverage: round(Math.max(...values), 1),
    lowestAverage: round(Math.min(...values), 1),
  };
}

function toTemplateCard(rc, termKey, meta, grading) {
  const columns = getColumnsForTerm(termKey);
  const colCount = columns.length;
  const subtotalColspan = colCount + 3; // CODE + SUBJECT + (columns) + COEF

  const mapSubject = (subject) => {
    const s = subject.scores || {};
    const cells = columns.map((c) => {
      let v = "";
      if (c.key === "yearAvg") v = avg([s.term1Avg, s.term2Avg]);
      else v = s[c.key];

      const isAvgKey =
        c.key === "term1Avg" ||
        c.key === "term2Avg" ||
        c.key === "term3Avg" ||
        c.key === "finalAvg" ||
        c.key === "yearAvg";

      const isLow = isNum(Number(v)) && Number(v) < 10;
      return {
        value: isNum(Number(v))
          ? isAvgKey
            ? Number(v).toFixed(1)
            : String(Math.round(Number(v)))
          : "",
        isAvg: isAvgKey,
        isLow,
      };
    });

    // per-row total = selected term avg * coef (or finalAvg for annual)
    let selAvg =
      termKey === "term1"
        ? s.term1Avg
        : termKey === "term2"
        ? s.term2Avg
        : termKey === "term3"
        ? s.term3Avg
        : s.finalAvg;

    const total = isNum(Number(selAvg))
      ? round(Number(selAvg) * subject.coef, 1)
      : "";

    const { remark, remarkClass } = remarkForAverage(selAvg, grading);
    return {
      code: subject.code,
      title: subject.title,
      coef: subject.coef,
      teacher: subject.teacher || "N/A",
      cells,
      total,
      remark,
      remarkClass,
    };
  };

  const generalRows = (rc.generalSubjects || []).map(mapSubject);
  const profRows = (rc.professionalSubjects || []).map(mapSubject);

  const subtotal = (rows) => {
    const totalWeighted = rows
      .map((r) => Number(r.total))
      .filter((x) => isNum(x))
      .reduce((a, b) => a + b, 0);
    const totalCoef = rows.reduce((sum, r) => sum + (Number(r.coef) || 0), 0);
    const average = totalCoef ? round(totalWeighted / totalCoef, 1) : "";
    const { remark, remarkClass } = remarkForAverage(average);
    return {
      totalWeighted: isNum(totalWeighted) ? Math.round(totalWeighted) : "",
      average,
      remark,
      remarkClass,
    };
  };

  const generalSubtotal = subtotal(generalRows);
  const professionalSubtotal = subtotal(profRows);

  const termTotals =
    termKey === "term1"
      ? rc.termTotals?.term1
      : termKey === "term2"
      ? rc.termTotals?.term2
      : termKey === "term3"
      ? rc.termTotals?.term3
      : rc.termTotals?.annual || {};

  const cumAvg =
    termKey === "term1"
      ? rc.termTotals?.term1?.average
      : termKey === "term2"
      ? avg([rc.termTotals?.term1?.average, rc.termTotals?.term2?.average])
      : termKey === "term3"
      ? avg([
          rc.termTotals?.term1?.average,
          rc.termTotals?.term2?.average,
          rc.termTotals?.term3?.average,
        ])
      : rc.termTotals?.annual?.average;

  return {
    logoUrl: meta.logoUrl || "",
    schoolName: meta.schoolName || "School",
    schoolLocation: meta.schoolLocation || "",
    schoolMotto: meta.schoolMotto || "",
    student: {
      term: meta.termLabel,
      academicYear: rc.student?.academicYear || "",
      name: rc.student?.name || "",
      registrationNumber: rc.student?.registrationNumber || "",
      dateOfBirth: rc.student?.dateOfBirth || "",
      class: rc.student?.class || "",
      option: rc.student?.option || "",
    },
    columns,
    columnsCount: colCount,
    subtotalColspan,
    generalSubjects: generalRows,
    professionalSubjects: profRows,
    subtotals: { general: generalSubtotal, professional: professionalSubtotal },
    termTotals: {
      total: isNum(Number(termTotals?.total))
        ? Math.round(Number(termTotals.total))
        : "",
      average: isNum(Number(termTotals?.average))
        ? round(Number(termTotals.average), 1)
        : "",
      rank: termTotals?.rank || "",
      outOf: termTotals?.outOf || "",
    },
    classStatistics: meta.classStats || {
      classAverage: "",
      highestAverage: "",
      lowestAverage: "",
    },
    cumulativeAverage: isNum(Number(cumAvg)) ? round(Number(cumAvg), 1) : "",
    administration: {
      classMaster: rc.administration?.classMaster || "",
      principal: rc.administration?.principal || "",
      decision: rc.administration?.decision || "",
      nextTermStarts: rc.administration?.nextTermStarts || "",
      parents: rc.administration.parents || "",
    },
    year: new Date().getFullYear(),
  };
}

// Build a minimal safe HTML for Puppeteer (one page per card)
// Build HTML for bulk report cards (A4 portrait, one page per card)
// Pass an absolute defaultLogoUrl like `${req.protocol}://${req.get('host')}/public/logo.png`
const imageDirectory = __dirname + "/../public/logo.png";

function buildHTML(
  reportCards,
  { defaultLogoUrl = imageDirectory } = {},
  grading
) {
  const css = `
/* ===============================
   Report Card Styles
=============================== */

/* Container for the report card */
.report-card-container {
  width: 100%;
  min-height: 100vh;
  background: #f5f5f5;
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

/* Main Report Card Container */
.report-card {
  width: 100%;
  max-width: 1200px;
  background: white;
  border: 2px solid #204080;
  padding: 20px;
  margin: 0 auto;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
  position: relative;
  overflow: hidden;
  font-family: "Arial", sans-serif;
  line-height: 1.3;
  font-size: 12px;
  page-break-after: always;
  break-inside: avoid;
}

/* Document Header */
.document-header {
  border-bottom: 2px solid #204080;
  padding: 15px;
  margin-bottom: 15px;
  background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
  border-radius: 6px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.left-section,
.right-section {
  flex: 1;
  text-align: center;
  font-size: 10px;
  line-height: 1.4;
}

.center-emblem {
  flex: 0 0 100px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.report-card-logo {
  height: 5rem;
  width: 5rem;
  object-fit: cover;
}

/* Header Text */
.republic-text {
  font-weight: bold;
  font-size: 11px;
  margin-bottom: 3px;
  text-transform: uppercase;
  color: #204080;
}

.motto {
  font-style: italic;
  font-size: 9px;
  margin-bottom: 3px;
  color: #c9a96e;
  font-weight: 600;
}

.ministry {
  font-weight: bold;
  font-size: 9px;
  margin-bottom: 3px;
  text-transform: uppercase;
  color: #204080;
}

/* School Info */
.school-info {
  text-align: center;
  margin: 15px 0;
  padding: 10px;
  border-top: 1px solid #204080;
  border-bottom: 1px solid #204080;
  background: linear-gradient(
    90deg,
    #f8f9ff 0%,
    #ffffff 50%,
    #f8f9ff 100%
  );
}

.school-name {
  font-size: 16px;
  font-weight: bold;
  text-transform: uppercase;
  color: #204080;
  letter-spacing: 2px;
  margin-bottom: 3px;
}

.school-location {
  font-size: 10px;
  color: #666;
  margin-bottom: 3px;
}

.school-motto {
  font-size: 9px;
  font-style: italic;
  font-weight: 600;
  color: #c9a96e;
}

/* Document Title */
.document-title {
  text-align: center;
  margin-top: 15px;
}

.document-title h1 {
  font-size: 18px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 5px;
  color: #204080;
}

.term-info {
  font-size: 12px;
  color: #666;
}

/* Student Information */
.student-info {
  margin-bottom: 15px;
  padding: 10px;
  border-radius: 4px;
  background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
  border: 1px solid #204080;
}

.info-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 15px 5px;
}

.info-table td {
  padding: 4px 8px;
  font-size: 11px;
  vertical-align: middle;
}

.info-table .label {
  font-weight: bold;
  width: 120px;
  color: #204080;
  white-space: nowrap;
}

.info-table .value {
  border-bottom: 1px solid #204080;
  min-width: 150px;
  font-weight: 600;
  color: #333;
}

/* Subjects Section */
.subjects-section {
  margin-bottom: 15px;
  break-inside: avoid;
}

.section-header {
  background: linear-gradient(135deg, #204080 0%, #3a5a9a 100%);
  color: #fff;
  text-align: center;
  padding: 8px;
  margin-bottom: 0;
  border-radius: 4px 4px 0 0;
}

.section-header h3 {
  font-size: 13px;
  font-weight: bold;
  text-transform: uppercase;
  margin: 0;
}

.subjects-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid #204080;
  border-radius: 0 0 4px 4px;
  overflow: hidden;
}

/* Any mark or average below 10 in red */

.subjects-table th,
.subjects-table td {
  border: 1px solid #204080;
  padding: 4px 3px;
  font-size: 9px;
  text-align: center;
  vertical-align: middle;
  line-height: 1.2;
}

.subjects-table th {
  background: linear-gradient(135deg, #e8eeff 0%, #f0f4ff 100%);
  font-weight: bold;
  text-transform: uppercase;
  color: #204080;
  height: 30px;
  font-size: 8px;
}

.code-cell {
  font-weight: bold;
  color: #204080;
  width: 40px;
}

.subject-cell {
  text-align: left;
  padding-left: 6px;
  font-weight: normal;
  color: #333;
  min-width: 140px;
  font-size: 8px;
}

.score-cell,
.avg-cell,
.coef-cell,
.total-cell {
  font-weight: bold;
  color: #333;
  width: 35px;
}

.avg-cell,
.total-cell {
  font-weight: bold;
  color: #204080;
  font-size: 9px;
}

.remark-cell {
  width: 70px;
}

.remark-cell span {
  font-size: 8px;
  font-weight: bold;
  display: inline-block;
  min-width: 50px;
  color: #333;
}

/* Grade Colors */
.remark-excellent { color: #0d5f0d; }
.remark-vgood     { color: #1a5f1a; }
.remark-good      { color: #204080; }
.remark-fairly-good { color: #b8860b; }
.remark-average   { color: #ff8c00; }
.remark-weak      { color: #cc0000; }

.teacher-cell {
  text-align: left;
  padding-left: 4px;
  font-size: 7px;
  color: #666;
  min-width: 80px;
}

.subtotal-row {
  background: linear-gradient(135deg, #e8eeff 0%, #f0f4ff 100%);
  font-weight: bold;
  border-top: 2px solid #204080;
}

.subtotal-label {
  text-transform: uppercase;
  font-size: 9px;
  color: #204080;
  text-align: right;
  padding-right: 10px;
}

.subtotal-value {
  font-size: 10px;
  font-weight: bold;
  color: #204080;
}

.subtotal-remark {
  font-weight: bold;
  color: #204080;
}

/* Performance Summary */
.performance-summary {
  margin-bottom: 15px;
  padding: 10px;
  border-radius: 4px;
  background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
  border: 1px solid #204080;
}

.summary-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 15px 6px;
}

.summary-table td {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: bold;
}

.summary-label {
  color: #204080;
  text-transform: uppercase;
}

.summary-value {
  color: #333;
  border-bottom: 1px solid #204080;
  min-width: 80px;
}

/* Bottom Section */
.bottom-section {
  display: flex;
  gap: 15px;
  margin-bottom: 15px;
}

.left-column,
.center-column,
.right-column {
  flex: 1;
}

.conduct-section,
.grading-scale,
.admin-section {
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #204080;
  background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
  height: 100%;
}

.conduct-section h4,
.grading-scale h4,
.admin-section h4 {
  text-align: center;
  font-weight: bold;
  font-size: 11px;
  color: #204080;
  border-bottom: 1px solid #204080;
  padding-bottom: 5px;
  margin-bottom: 10px;
}

.conduct-table,
.scale-table,
.admin-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 4px;
}

.conduct-table td,
.scale-table td,
.admin-table td {
  padding: 3px 5px;
  font-size: 9px;
}

.conduct-table td:first-child,
.scale-table td:first-child,
.admin-table td:first-child {
  font-weight: bold;
  color: #204080;
}

.conduct-table td:last-child,
.scale-table td:last-child,
.admin-table td:last-child {
  text-align: right;
  font-weight: bold;
  color: #333;
}

/* Signature Section */
.signature-section {
  display: flex;
  gap: 15px;
  margin-bottom: 15px;
  margin-top: 1.8rem;
}

.signature-box {
  flex: 1;
  padding: 15px 10px;
  border-radius: 4px;
  border: 1px solid #204080;
  text-align: center;
  background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
  min-height: 80px;
}

.signature-title {
  font-weight: bold;
  text-transform: uppercase;
  font-size: 10px;
  margin-bottom: 10px;
  color: #204080;
}

.signature-line {
  background-color: #204080;
  margin: 15px 0;
  height: 1px;
  width: 100%;
}

.signature-name {
  font-weight: bold;
  font-size: 9px;
  color: #333;
  margin-bottom: 3px;
}

.signature-date {
  font-size: 8px;
  font-style: italic;
  color: #666;
}

/* Watermark uses CSS variable --wm pointing to the logo URL */
.report-card::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-15deg);
  width: 550px;
  height: 550px;
  background: var(--wm) no-repeat center;
  background-size: contain;
  z-index: 10;
  pointer-events: none;
  opacity: 0.04;
}

/* Footer */
.footer-text {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  font-size: 12px;
  color: rgb(102, 102, 102);
  display: none;
}

/* ===============================
     PROFESSIONAL PRINT STYLES
  =============================== */
@media print {
  @page {
    size: A4;
    margin: 12mm;
    background: white;
  }

  .footer-text { display: flex; }

  .report-card::before {
    content: "";
    position: absolute;
    top: 60%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-15deg);
    width: 450px;
    height: 450px;
    background: var(--wm) no-repeat center;
    background-size: contain;
    z-index: 10;
    pointer-events: none;
    opacity: 0.08;
  }

  * {
    -webkit-print-color-adjust: exact !important;
    color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  html, body {
    overflow: visible !important;
    background: #fff !important;
    display: flex;
    align-items: start;
    justify-content: center;
  }

  body {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
    overflow: hidden !important;
  }

  .report-card-container {
    background: white !important;
    padding: 0 !important;
    min-height: auto !important;
    height: auto !important;
    visibility: visible !important;
    box-shadow: none !important;
    width: 100% !important;
    font-size: 11px !important;
    line-height: 1.12 !important;
  }

  .report-card-container * { visibility: visible !important; }

  .report-card {
    width: 98% !important;
    max-width: 98% !important;
    box-shadow: none !important;
    border: none !important;
    padding: 8px !important;
    margin: 0 !important;
    overflow: visible !important;
    font-size: 11px !important;
    line-height: 1.1 !important;
    height: auto !important;
    max-height: none !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  .document-header { padding: 6px !important; margin-bottom: 8px !important; background: white !important; }
  .header-content { margin-bottom: 8px !important; }
  .report-card-logo { width: 90px !important; height: 90px !important; }
  .school-info { margin: 8px 0 !important; padding: 6px !important; background: white !important; }
  .school-name { font-size: 21px !important; margin-bottom: 2px !important; }
  .document-title h1 { font-size: 21px !important; margin-bottom: 3px !important; }
  .term-info { font-size: 16px !important; }

  .student-info { margin-bottom: 10px !important; padding: 6px !important; background: white !important; }
  .info-table { border-spacing: 8px 2px !important; }
  .info-table td { font-size: 11px !important; padding: 2px 4px !important; }

  .subjects-section { margin-bottom: 8px !important; }
  .section-header { padding: 4px !important; background: #204080 !important; color: white !important; display: flex !important; justify-content: center !important; }
  .section-header h3 { font-size: 16px !important; }

  .subjects-table th, .subjects-table td { font-size: 10px !important; padding: 1px 2px !important; line-height: 1.1 !important; }
  .subjects-table th { height: 20px !important; background: #e8eeff !important; color: #204080 !important; }
  .subject-cell { font-size: 10px !important; padding-left: 3px !important; }
  .teacher-cell { font-size: 9px !important; padding-left: 2px !important; }

  .performance-summary { margin-bottom: 8px !important; padding: 6px !important; background: white !important; }
  .summary-table { border-spacing: 8px 3px !important; }
  .summary-table td { font-size: 11px !important; padding: 2px 6px !important; }

  .bottom-section { gap: 8px !important; margin-bottom: 8px !important; }
  .conduct-section, .grading-scale, .admin-section { padding: 6px !important; background: white !important; }
  .conduct-section h4, .grading-scale h4, .admin-section h4 { font-size: 12px !important; margin-bottom: 6px !important; padding-bottom: 3px !important; }
  .conduct-table td, .scale-table td, .admin-table td { font-size: 10px !important; padding: 1px 3px !important; }
  .conduct-table, .scale-table, .admin-table { border-spacing: 0 2px !important; }

  .signature-section { gap: 8px !important; margin-bottom: 0 !important; }
  .signature-box { padding: 8px 6px !important; min-height: 50px !important; background: white !important; }
  .signature-title { font-size: 12px !important; margin-bottom: 6px !important; }
  .signature-line { margin: 8px 0 !important; height: 1px !important; width: 100% !important; }
  .signature-name { font-size: 11px !important; margin-bottom: 2px !important; }
  .signature-date { font-size: 12px !important; }
}

/* Responsive */
@media (max-width: 768px) {
  .report-card-container { padding: 10px; }
  .report-card { padding: 15px; max-width: 100%; }
  .header-content { text-align: center; }
  .left-section, .right-section, .center-emblem { margin-bottom: 10px; }
  .info-table { border-spacing: 8px 4px; }
  .subjects-table th, .subjects-table td { font-size: 8px; padding: 3px 2px; }
  .bottom-section { gap: 10px; }
  .signature-section { gap: 10px; }
}

/* ========== AUTO-FIT TO ONE PAGE (A4) ========== */
@media print {
  :root {
    --page-width-mm: 210;
    --page-height-mm: 297;
    --page-margin-mm: 4;
    --print-scale: 1;
  }

  @page {
    size: A4 portrait;
    margin: calc(var(--page-margin-mm) * 1mm);
  }

  .report-card-container {
    width: calc((var(--page-width-mm) - 2 * var(--page-margin-mm)) * 1mm) !important;
    margin: 0 auto !important;
  }

  #reportCard {
    width: calc(((var(--page-width-mm) - 2 * var(--page-margin-mm)) * 1mm) / var(--print-scale)) !important;
    transform: scale(var(--print-scale)) !important;
    transform-origin: top center !important;
  }

  .report-card {
    font-size: 11px !important;
    line-height: 1.12 !important;
  }

  .subjects-table th, .subjects-table td {
    font-size: 10px !important;
    line-height: 1.1 !important;
    padding: 1px 2px !important;
  }

  .subject-cell { font-size: 10px !important; padding-left: 3px !important; }
  .teacher-cell { font-size: 9px !important; padding-left: 2px !important; }
  .summary-table td { font-size: 11px !important; }
}
`;

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m])
    );

  const renderCells = (cells = []) =>
    cells
      .map((c) => {
        const cls = `${c.isAvg ? "avg-cell" : "score-cell"} ${
          c.isLow ? "low-score" : ""
        }`;
        return `<td class="${cls}">${esc(c.value)}</td>`;
      })
      .join("");

  const renderSubjectRows = (subjects = []) =>
    subjects
      .map((r) => {
        return `<tr class="subject-row">
          <td class="code-cell">${esc(r.code)}</td>
          <td class="subject-cell">${esc(r.title)}</td>
          ${renderCells(r.cells)}
          <td class="coef-cell">${esc(r.coef)}</td>
          <td class="total-cell">${esc(r.total)}</td>
          <td class="remark-cell"><span class="${esc(r.remarkClass)}">${esc(
          r.remark
        )}</span></td>
          <td class="teacher-cell">${esc(r.teacher)}</td>
        </tr>`;
      })
      .join("");

  const cardsHTML = reportCards
    .map((rc) => {
      const logoUrl =
        rc.logoUrl && rc.logoUrl.trim() ? rc.logoUrl : defaultLogoUrl;
      const colsHead = rc.columns
        .map((c) => `<th>${esc(c.label)}</th>`)
        .join("");
      const generalRows = renderSubjectRows(rc.generalSubjects);
      const profRows = renderSubjectRows(rc.professionalSubjects);

      const gradingRows = (grading || [])
        .map((g) => {
          // simple class mapping by lower bound
          let remarkClass = "remark-good";
          const min = Number(g.band_min);
          if (!Number.isNaN(min)) {
            if (min >= 18) remarkClass = "remark-excellent";
            else if (min >= 16) remarkClass = "remark-vgood";
            else if (min >= 14) remarkClass = "remark-good";
            else if (min >= 12) remarkClass = "remark-fairly-good";
            else if (min >= 10) remarkClass = "remark-average";
            else remarkClass = "remark-weak";
          }
          return `<tr><td>${esc(g.band_min)}-${esc(
            g.band_max
          )}:</td><td><span class="${remarkClass}">${esc(
            g.comment
          )}</span></td></tr>`;
        })
        .join("");

      const conductRows = `
        <tr><td>Days Present:</td><td>${esc(
          rc.conduct?.attendanceDays ?? ""
        )}/${esc(rc.conduct?.totalDays ?? "")}</td></tr>
        <tr><td>Times Late:</td><td>${esc(
          rc.conduct?.timesLate ?? ""
        )}</td></tr>
        <tr><td>Disciplinary Actions:</td><td>${esc(
          rc.conduct?.disciplinaryActions ?? ""
        )}</td></tr>
      `;

      return `
<section class="report-card" style="--wm: url('${logoUrl}')">
  <div class="document-header">
    <div class="header-content">
      <div class="left-section">
        <div class="republic-text">REPUBLIC OF CAMEROON</div>
        <div class="motto">Peace • Work • Fatherland</div>
        <div class="ministry">MINISTRY OF EMPLOYMENT AND VOCATIONAL TRAINING</div>
      </div>
      <div class="center-emblem">
        <img src="${logoUrl}" alt="Logo" class="report-card-logo" />
      </div>
      <div class="right-section">
        <div class="republic-text">RÉPUBLIQUE DU CAMEROUN</div>
        <div class="motto">Paix • Travail • Patrie</div>
        <div class="ministry">MINISTÈRE DE L'EMPLOI ET DE LA FORMATION PROFESSIONNELLE</div>
      </div>
    </div>

    <div class="school-info">
      <div class="school-name">${esc(rc.schoolName)}</div>
      <div class="school-location">${esc(rc.schoolLocation)}</div>
      <div class="school-motto">${esc(rc.schoolMotto)}</div>
    </div>

    <div class="document-title">
      <h1>ACADEMIC REPORT CARD</h1>
      <div class="term-info">${esc(rc.student.term)} • ${esc(
        rc.student.academicYear
      )}</div>
    </div>
  </div>

  <div class="student-info">
    <table class="info-table">
      <tbody>
        <tr>
          <td class="label">Student Name:</td>
          <td class="value">${esc(rc.student.name)}</td>
          <td class="label">Class:</td>
          <td class="value">${esc(rc.student.class)}</td>
        </tr>
        <tr>
          <td class="label">Registration No:</td>
          <td class="value">${esc(rc.student.registrationNumber)}</td>
          <td class="label">Specialty:</td>
          <td class="value">${esc(rc.student.option)}</td>
        </tr>
        <tr>
          <td class="label">Date of Birth:</td>
          <td class="value">${esc(rc.student.dateOfBirth)}</td>
          <td class="label">Academic Year:</td>
          <td class="value">${esc(rc.student.academicYear)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- General Subjects -->
  <div class="subjects-section">
    <div class="section-header"><h3>GENERAL SUBJECTS</h3></div>
    <table class="subjects-table">
      <thead>
        <tr>
          <th>CODE</th>
          <th>SUBJECT TITLE</th>
          ${colsHead}
          <th>COEF</th>
          <th>TOTAL</th>
          <th>REMARK</th>
          <th>TEACHER</th>
        </tr>
      </thead>
      <tbody>
        ${generalRows}
        <tr class="subtotal-row">
          <td colspan="${
            rc.subtotalColspan
          }" class="subtotal-label">SUB TOTAL:</td>
          <td class="subtotal-value">${esc(
            rc.subtotals.general.totalWeighted
          )}</td>
          <td class="subtotal-remark"><span class="${esc(
            rc.subtotals.general.remarkClass
          )}">${esc(rc.subtotals.general.remark)}</span></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Professional Subjects -->
  <div class="subjects-section">
    <div class="section-header"><h3>PROFESSIONAL SUBJECTS</h3></div>
    <table class="subjects-table">
      <thead>
        <tr>
          <th>CODE</th>
          <th>SUBJECT TITLE</th>
          ${colsHead}
          <th>COEF</th>
          <th>TOTAL</th>
          <th>REMARK</th>
          <th>TEACHER</th>
        </tr>
      </thead>
      <tbody>
        ${profRows}
        <tr class="subtotal-row">
          <td colspan="${
            rc.subtotalColspan
          }" class="subtotal-label">SUB TOTAL:</td>
          <td class="subtotal-value">${esc(
            rc.subtotals.professional.totalWeighted
          )}</td>
          <td class="subtotal-remark"><span class="${esc(
            rc.subtotals.professional.remarkClass
          )}">${esc(rc.subtotals.professional.remark)}</span></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Performance Summary -->
  <div class="performance-summary">
    <table class="summary-table">
      <tbody>
        <tr>
          <td class="summary-label">GRAND TOTAL:</td>
          <td class="summary-value">${esc(rc.termTotals.total)}</td>
          <td class="summary-label">STUDENT AVERAGE:</td>
          <td class="summary-value">${esc(rc.termTotals.average)}/20</td>
        </tr>
        <tr>
          <td class="summary-label">CLASS AVERAGE:</td>
          <td class="summary-value">${esc(
            rc.classStatistics.classAverage
          )}/20</td>
          <td class="summary-label">CLASS RANK:</td>
          <td class="summary-value">${esc(rc.termTotals.rank)}° of ${esc(
        rc.termTotals.outOf
      )}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Bottom Section -->
  <div class="bottom-section">
    <div class="left-column">
      <div class="conduct-section">
        <h4>CONDUCT & ATTENDANCE</h4>
        <table class="conduct-table">
          <tbody>
            ${conductRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="center-column">
      <div class="grading-scale">
        <h4>GRADING SCALE</h4>
        <table class="scale-table">
          <tbody>
            ${gradingRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="right-column">
      <div class="admin-section">
        <h4>ADMINISTRATION</h4>
        <table class="admin-table">
          <tbody>
            <tr>
              <td>Class Master:</td>
              <td>${esc(
                (rc.administration.classMaster || "").toUpperCase()
              )}</td>
            </tr>
            <tr>
              <td>Decision:</td>
              <td><span class="remark-good">${esc(
                rc.administration.decision || ""
              )}</span></td>
            </tr>
            <tr>
              <td>Next Term:</td>
              <td>${esc(rc.administration.nextTermStarts || "")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Signatures -->
  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-title">CLASS MASTER</div>
      <div class="signature-line"></div>
      <div class="signature-name">${esc(
        (rc.administration.classMaster || "").toUpperCase()
      )}</div>
      <div class="signature-date">Date & Signature</div>
    </div>
    <div class="signature-box">
      <div class="signature-title">PRINCIPAL</div>
      <div class="signature-line"></div>
      <div class="signature-name">${esc(
        (rc.administration.principal || "").toUpperCase()
      )}</div>
      <div class="signature-date">Date, Signature & Seal</div>
    </div>
    <div class="signature-box">
      <div class="signature-title">PARENT/GUARDIAN</div>
      <div class="signature-line"></div>
      <div class="signature-name">${rc.administration.parents.toUpperCase()}</div>
      <div class="signature-date">Date & Signature</div>
    </div>
  </div>

  <span class="footer-text">© ${esc(
    rc.year
  )} Izzy Tech Team – Official Document | Votech (S7) Academy</span>
</section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Report Cards</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${css}</style>
  </head>
  <body>
    <div class="batch-wrapper">
      ${cardsHTML}
    </div>
  </body>
</html>`;
}

function selectedTermKey(rawTerm) {
  const t = String(rawTerm ?? "annual")
    .trim()
    .toLowerCase();

  // Direct strings
  if (t === "annual" || t === "all") return "annual";
  if (t === "term1" || t === "t1") return "term1";
  if (t === "term2" || t === "t2") return "term2";
  if (t === "term3" || t === "t3") return "term3";

  // Numeric inputs (try to interpret as order_number 1/2/3)
  const n = Number(t);
  if (!Number.isNaN(n) && [1, 2, 3].includes(n)) return `term${n}`;

  // Otherwise default to annual
  return "annual";
}

function termLabelFromKey(termKey) {
  return termKey === "term1"
    ? "FIRST TERM"
    : termKey === "term2"
    ? "SECOND TERM"
    : termKey === "term3"
    ? "THIRD TERM"
    : "ANNUAL";
}

const bulkReportCardsPdf = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId, term = "annual" } = req.query;

  // Helpers (scoped here for drop-in use)
  const sanitizeFilename = (s = "") => String(s).replace(/[^\w\-]+/g, "_");

  // Map flexible input → 'term1' | 'term2' | 'term3' | 'annual'
  // Supports: "annual", "term2"/"t2", 2 (order_number), or a Term.id within the academic year
  const resolveTermKey = async (rawTerm) => {
    const t = String(rawTerm ?? "annual")
      .trim()
      .toLowerCase();

    if (t === "annual" || t === "all" || t === "") return "annual";
    if (t === "term1" || t === "t1") return "term1";
    if (t === "term2" || t === "t2") return "term2";
    if (t === "term3" || t === "t3") return "term3";

    const n = Number(t);
    if (!Number.isNaN(n)) {
      if ([1, 2, 3].includes(n)) return `term${n}`; // order_number
      // Try as Term PK within the AY
      const termRow = await models.Term.findOne({
        where: { id: n, academic_year_id: academicYearId },
        attributes: ["order_number"],
      });
      if (termRow && [1, 2, 3].includes(Number(termRow.order_number))) {
        return `term${termRow.order_number}`;
      }
    }
    return "annual";
  };

  const termLabelFromKey = (termKey) =>
    termKey === "term1"
      ? "FIRST TERM"
      : termKey === "term2"
      ? "SECOND TERM"
      : termKey === "term3"
      ? "THIRD TERM"
      : "ANNUAL";

  // Validate required params
  if (!academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Fetch AY, department, class + classMaster
  const academicYearData = await models.AcademicYear.findByPk(academicYearId);
  if (!academicYearData)
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));

  const department = await models.specialties.findByPk(departmentId);
  if (!department)
    return next(new AppError("Department not found", StatusCodes.NOT_FOUND));

  const studentClass = await models.Class.findByPk(classId, {
    include: [
      {
        model: models.users,
        as: "classMaster",
        attributes: ["name", "username"],
      },
    ],
  });
  if (!studentClass)
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));

  const classMaster =
    studentClass?.classMaster?.name ||
    studentClass?.classMaster?.username ||
    "";

  // Resolve which "view" to render (do not filter DB by term)
  const termKey = await resolveTermKey(term);

  // Fetch all marks for the class/year so cumulative/annual calculations work
  const marks = await models.marks.findAll({
    where: { academic_year_id: academicYearId, class_id: classId },
    include: [
      {
        model: models.students,
        as: "student",
        attributes: [
          "id",
          "full_name",
          "student_id",
          "date_of_birth",
          "father_name",
          "mother_name",
        ],
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

  if (!marks.length) {
    return next(
      new AppError(
        `No marks available for ${studentClass.name} in ${department.name} (${academicYearData.name}).`,
        StatusCodes.NOT_FOUND
      )
    );
  }

  // Build cards and class stats for the selected view
  const cards = buildReportCardsFromMarks(marks, classMaster);
  const classStats = computeClassStatsForTerm(cards, termKey);

  const grading = await models.academic_bands.findAll({
    where: {
      academic_year_id: academicYearData.id,
      class_id: studentClass.id,
    },
  });

  const meta = {
    schoolName: req.query.schoolName || "VOTECH (S7) ACADEMY",
    schoolLocation: req.query.schoolLocation || "Azire, Mankon - Bamenda",
    schoolMotto:
      req.query.schoolMotto || "Excellence • Productivity • Self Actualization",
    logoUrl: req.query.logoUrl || "",
    termLabel: termLabelFromKey(termKey),
    classStats,
  };

  const reportCards = cards.map((rc) =>
    toTemplateCard(rc, termKey, meta, grading)
  );
  const defaultLogoUrl = `${req.protocol}://${req.get("host")}/public/logo.png`;
  const html = buildHTML(reportCards, { defaultLogoUrl }, grading);

  // Render HTML to PDF via Puppeteer
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "4mm", right: "10mm", bottom: "4mm", left: "10mm" },
    });

    // Descriptive filename incl. AY, Dept, Class, Term
    const filename = `${sanitizeFilename(
      academicYearData.name
    )}-${sanitizeFilename(department.name)}-${sanitizeFilename(
      studentClass.name
    )}-${sanitizeFilename(meta.termLabel)}-report-cards.pdf`;

    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length,
    });

    res.end(pdfBuffer);
    console.log("Report card PDF generated successfully.");
  } finally {
    await browser.close();
  }
});
module.exports = { bulkReportCards, singleReportCard, bulkReportCardsPdf };
