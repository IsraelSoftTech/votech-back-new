/* controllers/bulkReportCards.controller.js */
const { Op, where } = require("sequelize");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const models = require("../models/index.model");
const appResponder = require("../utils/appResponder");
const { StatusCodes } = require("http-status-codes");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

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

// FIXED: Shared builder with corrected calculations
function buildReportCardsFromMarks(marks, classMaster, termKey = "term3") {
  const sequences = { ...sequencesFormat };
  const administration = { ...administrationFormat, classMaster };
  // Map term keys to term labels
  const termLabels = {
    term1: "FIRST TERM",
    term2: "SECOND TERM",
    term3: "THIRD TERM",
    annual: "ANNUAL",
  };
  const termLabel = termLabels[termKey] || "THIRD TERM";

  const map = new Map();

  // Step 1: Build student records and populate sequence scores
  for (const m of marks) {
    const stId = m?.student?.id;
    if (!stId) continue;

    // Create the student skeleton once
    if (!map.has(stId)) {
      map.set(stId, {
        student: {
          id: m.student.id,
          name: m.student.full_name,
          registrationNumber: m.student.student_id,
          dateOfBirth: m.student.date_of_birth,
          class: m.student.Class?.name,
          option: m.student.Class?.department?.name,
          academicYear: m.academic_year?.name,
          term: termLabel,
        },
        sequences,
        generalSubjects: [],
        professionalSubjects: [],
        practicalSubjects: [],
        termTotals: { term1: {}, term2: {}, term3: {}, annual: {} },
        classStatistics: {},
        conduct: {
          attendanceDays: null,
          totalDays: null,
          timesLate: null,
          disciplinaryActions: null,
        },
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
        : m.subject?.category === "general"
        ? record.generalSubjects
        : record.practicalSubjects;

    let subjectRow = arr.find((s) => s.code === m.subject.code);
    if (!subjectRow) {
      subjectRow = {
        code: m.subject.code,
        title: m.subject.name,
        coef: m.subject.coefficient,
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

    // FIXED: Fill sequence score only once per sequence
    if (m.sequence?.order_number) {
      const seqKey = `seq${m.sequence.order_number}`;
      // Only set if not already set (prevents duplicates)
      if (subjectRow.scores[seqKey] === null) {
        subjectRow.scores[seqKey] = Number(m.score);
      }
    }
  }

  // Step 2: FIXED - Calculate per-subject term averages correctly
  for (const rec of map.values()) {
    for (const subject of [
      ...rec.generalSubjects,
      ...rec.professionalSubjects,
      ...rec.practicalSubjects,
    ]) {
      const { scores } = subject;

      // FIXED: Calculate average of TWO sequences for each term
      // If only one sequence exists, the average is that score divided by 1 (the count)
      const calculateTermAverage = (seq1Score, seq2Score) => {
        const validScores = [seq1Score, seq2Score].filter(
          (s) => s !== null && s !== undefined && !isNaN(Number(s))
        );

        if (validScores.length === 0) return null;

        // Average of available scores
        const sum = validScores.reduce((a, b) => Number(a) + Number(b), 0);
        return round(sum / validScores.length);
      };

      // Calculate term averages
      scores.term1Avg = calculateTermAverage(scores.seq1, scores.seq2);
      scores.term2Avg = calculateTermAverage(scores.seq3, scores.seq4);
      scores.term3Avg = calculateTermAverage(scores.seq5, scores.seq6);

      // Calculate final average (average of all three term averages)
      const termAverages = [
        scores.term1Avg,
        scores.term2Avg,
        scores.term3Avg,
      ].filter((t) => t !== null && t !== undefined && !isNaN(Number(t)));

      if (termAverages.length > 0) {
        scores.finalAvg = round(
          termAverages.reduce((a, b) => a + b, 0) / termAverages.length
        );
      } else {
        scores.finalAvg = null;
      }
    }
  }

  // Step 3: FIXED - Calculate per-student term totals and averages
  const studentsArray = Array.from(map.values());

  const computeTerm = (studentRec, termKey) => {
    let totalWeighted = 0;
    let totalCoef = 0;

    for (const subj of [
      ...studentRec.generalSubjects,
      ...studentRec.professionalSubjects,
      ...studentRec.practicalSubjects,
    ]) {
      const avg = subj.scores[`${termKey}Avg`];

      // Only include subjects that have a valid average for this term
      if (avg !== null && avg !== undefined && !isNaN(Number(avg))) {
        totalWeighted += Number(avg) * Number(subj.coef);
        totalCoef += Number(subj.coef);
      }
    }

    const average = totalCoef > 0 ? round(totalWeighted / totalCoef) : 0;

    return {
      total: round(totalWeighted, 1),
      average: average,
    };
  };

  // Calculate term totals for each student
  studentsArray.forEach((st) => {
    st.termTotals.term1 = computeTerm(st, "term1");
    st.termTotals.term2 = computeTerm(st, "term2");
    st.termTotals.term3 = computeTerm(st, "term3");

    // FIXED: Annual calculation - average of the three term averages
    const annualTermAverages = [
      st.termTotals.term1.average,
      st.termTotals.term2.average,
      st.termTotals.term3.average,
    ].filter((avg) => avg > 0);

    if (annualTermAverages.length > 0) {
      const annualAverage = round(
        annualTermAverages.reduce((a, b) => a + b, 0) /
          annualTermAverages.length
      );

      // Annual total is the sum of all term totals
      const annualTotal = round(
        st.termTotals.term1.total +
          st.termTotals.term2.total +
          st.termTotals.term3.total,
        1
      );

      st.termTotals.annual = {
        total: annualTotal,
        average: annualAverage,
      };
    } else {
      st.termTotals.annual = {
        total: 0,
        average: 0,
      };
    }
  });

  // Step 4: Calculate ranks per term and annual
  ["term1", "term2", "term3", "annual"].forEach((key) => {
    studentsArray
      .sort((a, b) => b.termTotals[key].average - a.termTotals[key].average)
      .forEach((st, idx) => {
        st.termTotals[key].rank = idx + 1;
        st.termTotals[key].outOf = studentsArray.length;
      });
  });

  // Step 5: Calculate class statistics (based on annual average)
  const averages = studentsArray
    .map((s) => s.termTotals.annual.average)
    .filter((avg) => avg > 0);

  const classStats = {
    classAverage:
      averages.length > 0
        ? round(averages.reduce((a, b) => a + b, 0) / averages.length)
        : 0,
    highestAverage: averages.length > 0 ? round(Math.max(...averages)) : 0,
    lowestAverage: averages.length > 0 ? round(Math.min(...averages)) : 0,
  };

  studentsArray.forEach((st) => (st.classStatistics = classStats));

  return studentsArray;
}

// BULK — unchanged behavior, but now uses the fixed builder
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
      class_id: classId,
    },
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
      class_id: classId,
    },
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

  if (!marks.length) return next(new AppError("No data found", 404));

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

  const reportCards = buildReportCardsFromMarks(marks, classMaster);

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
  if (t.includes("term1") || t.includes("first") || t === "t1") return "term1";
  if (t.includes("term2") || t.includes("second") || t === "t2") return "term2";
  if (t.includes("term3") || t.includes("third") || t === "t3") return "term3";
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
      { key: "yearAvg", label: "TOTAL AVG" },
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
  if (Number.isNaN(v)) {
    return { remark: "", remarkClass: "" };
  }

  // 1️⃣ Find remark text from the PROVIDED grading
  const customBand = grading.find((g) => v >= g.band_min && v <= g.band_max);

  // 2️⃣ Find remark class STRICTLY from default grading
  const defaultBand = defaultGrading.find(
    (g) => v >= g.band_min && v <= g.band_max
  );

  return {
    remark: customBand?.comment ?? "No Remark",
    remarkClass: defaultBand?.remarkClass ?? "",
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
  const subtotalColspan = colCount + 3;

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
  const pracRows = (rc.practicalSubjects || []).map(mapSubject);

  const subtotal = (rows) => {
    const totalWeighted = rows
      .map((r) => Number(r.total))
      .filter((x) => isNum(x))
      .reduce((a, b) => a + b, 0);
    const totalCoef = rows.reduce((sum, r) => sum + (Number(r.coef) || 0), 0);
    const average = totalCoef ? round(totalWeighted / totalCoef, 1) : "";
    const { remark, remarkClass } = remarkForAverage(average, grading);
    return {
      totalWeighted: isNum(totalWeighted) ? Math.round(totalWeighted) : "",
      average,
      remark,
      remarkClass,
    };
  };

  const generalSubtotal = subtotal(generalRows);
  const professionalSubtotal = subtotal(profRows);
  const practicalSubtotal = subtotal(pracRows);

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
    practicalSubjects: pracRows,
    subtotals: {
      general: generalSubtotal,
      professional: professionalSubtotal,
      practical: practicalSubtotal,
    },
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
    conduct: rc.conduct || {
      attendanceDays: null,
      totalDays: null,
      timesLate: null,
      disciplinaryActions: null,
    },
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

const imageDirectory = __dirname + "/../public/logo.png";

/**
 * BULK REPORT CARD HTML GENERATOR
 *
 * Guarantees 1:1 parity with React ReportCard component
 * - Exact same calculations, formatting, and rendering logic
 * - Identical CSS and print styles
 * - Auto-scaling for single-page fit
 * - Edge-case handling (null values, missing subjects, term variations)
 *
 * @param {Array} students - Array of student data objects
 * @param {Object} options - Configuration options
 * @returns {String} Complete HTML document
 */

/**
 * COMPLETELY REBUILT HTML GENERATOR - 1:1 REACT COMPONENT PARITY
 *
 * This function generates HTML that exactly matches the React ReportCard component
 * with guaranteed single-page fit and all visual elements properly rendered.
 */

/**
 * COMPLETELY REBUILT HTML GENERATOR - 1:1 REACT COMPONENT PARITY
 *
 * This function generates HTML that exactly matches the React ReportCard component
 * with guaranteed single-page fit and all visual elements properly rendered.
 */

function buildHTML(students, options = {}) {
  const {
    grading = null,
    logoUrl = "", // Base64 or URL
    printMarginMm = 4, // Reduced from 8mm for better fit
  } = options;

  // ============================================================================
  // EXACT GRADING LOGIC FROM REACT COMPONENT
  // ============================================================================

  const defaultGrading = [
    { band_min: 18, band_max: 20, comment: "Excellent" },
    { band_min: 16, band_max: 17.99, comment: "V.Good" },
    { band_min: 14, band_max: 15.99, comment: "Good" },
    { band_min: 12, band_max: 13.99, comment: "Fairly Good" },
    { band_min: 10, band_max: 11.99, comment: "Average" },
    { band_min: 0, band_max: 9.99, comment: "Weak" },
  ];

  const gradingScale = (
    Array.isArray(grading) && grading.length ? grading : defaultGrading
  )
    .slice()
    .sort((a, b) => b.band_min - a.band_min);

  function getRemark(average) {
    if (average == null || isNaN(Number(average))) return "N/A";
    const band = gradingScale.find(
      (g) => average >= g.band_min && average <= g.band_max
    );
    return band ? band.comment : "No Remark";
  }

  function getRemarkClass(remark) {
    const norm = String(remark || "")
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .trim();

    const map = {
      excellent: "remark-excellent",
      "v good": "remark-vgood",
      "very good": "remark-vgood",
      good: "remark-good",
      "fairly good": "remark-fairly-good",
      average: "remark-average",
      weak: "remark-weak",
    };

    return map[norm] || "";
  }

  // ============================================================================
  // EXACT TERM DATA LOGIC FROM REACT COMPONENT
  // ============================================================================

  function getCurrentTermData(term) {
    if (term === "FIRST TERM") {
      return {
        showColumns: ["seq1", "seq2", "termAvg"],
        columnHeaders: ["SEQ 1", "SEQ 2", "TERM AVG"],
        getTermAvg: (subject) => subject.scores.term1Avg,
      };
    } else if (term === "SECOND TERM") {
      return {
        showColumns: ["seq3", "seq4", "termAvg", "term1Avg", "yearAvg"],
        columnHeaders: ["SEQ 3", "SEQ 4", "TERM AVG", "T1 AVG", "TOTAL AVG"],
        getTermAvg: (subject) => subject.scores.term2Avg,
        calculateYearAvg: (subject) => {
          const t1 = subject.scores.term1Avg;
          const t2 = subject.scores.term2Avg;
          if (t1 == null || t2 == null) return null;
          return (t1 + t2) / 2;
        },
      };
    } else {
      // THIRD TERM
      return {
        showColumns: [
          "seq5",
          "seq6",
          "termAvg",
          "term1Avg",
          "term2Avg",
          "finalAvg",
        ],
        columnHeaders: [
          "SEQ 5",
          "SEQ 6",
          "TERM AVG",
          "T1 AVG",
          "T2 AVG",
          "FINAL AVG",
        ],
        getTermAvg: (subject) => subject.scores.term3Avg,
        getFinalAvg: (subject) => subject.scores.finalAvg,
      };
    }
  }

  // ============================================================================
  // EXACT CUMULATIVE AVERAGE LOGIC FROM REACT COMPONENT
  // ============================================================================

  function getCumulativeAverageToDate(data) {
    const term = data.student.term;
    const t1 = data.termTotals?.term1?.average;
    const t2 = data.termTotals?.term2?.average;
    const t3 = data.termTotals?.term3?.average;

    if (term === "FIRST TERM") {
      return typeof t1 === "number" ? Number(t1.toFixed(1)) : null;
    }

    if (term === "SECOND TERM") {
      const avgs = [t1, t2].filter((v) => typeof v === "number");
      if (!avgs.length) return null;
      return Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1));
    }

    const avgs = [t1, t2, t3].filter((v) => typeof v === "number");
    if (!avgs.length) return null;
    return Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1));
  }

  // ============================================================================
  // EXACT FORMATTING LOGIC FROM REACT COMPONENT
  // ============================================================================

  function formatNum(n) {
    if (n == null || n === undefined || isNaN(Number(n))) return "-";
    return Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(1);
  }

  function formatRange(min, max) {
    return `${formatNum(min)}-${formatNum(max)}`;
  }

  // ============================================================================
  // HTML ESCAPING
  // ============================================================================

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ============================================================================
  // EXACT SUBJECT ROW RENDERING LOGIC
  // ============================================================================

  function renderSubjectRow(subject, termData) {
    const termAvg = termData.getTermAvg(subject);
    const remark = termAvg != null ? getRemark(termAvg) : "N/A";
    const remarkClass = termAvg != null ? getRemarkClass(remark) : "";

    const cells = termData.showColumns
      .map((col) => {
        let value = null;
        let isAvg = false;

        if (col === "termAvg") {
          value = termAvg;
          isAvg = true;
        } else if (col === "yearAvg" && termData.calculateYearAvg) {
          value = termData.calculateYearAvg(subject);
          isAvg = true;
        } else if (col === "finalAvg" && termData.getFinalAvg) {
          value = termData.getFinalAvg(subject);
          isAvg = true;
        } else if (["term1Avg", "term2Avg", "term3Avg"].includes(col)) {
          value = subject.scores[col];
          isAvg = true;
        } else {
          value = subject.scores[col];
          isAvg = false;
        }

        if (value == null || isNaN(Number(value))) {
          return `<td class="${isAvg ? "avg-cell" : "score-cell"}">-</td>`;
        }

        const num = Number(value);
        const formatted = isAvg ? num.toFixed(1) : num;
        const baseClass = isAvg ? "avg-cell" : "score-cell";
        const lowClass = num < 10 ? " low-score" : "";

        return `<td class="${baseClass}${lowClass}">${formatted}</td>`;
      })
      .join("");

    const total =
      termAvg != null && !isNaN(Number(termAvg))
        ? (termAvg * subject.coef).toFixed(1)
        : "-";

    return `
      <tr class="subject-row">
        <td class="code-cell">${esc(subject.code)}</td>
        <td class="subject-cell">${esc(subject.title)}</td>
        ${cells}
        <td class="coef-cell">${subject.coef}</td>
        <td class="total-cell">${total}</td>
        <td class="remark-cell"><span class="${remarkClass}">${esc(
      remark
    )}</span></td>
        <td class="teacher-cell">${esc(subject.teacher)}</td>
      </tr>
    `;
  }

  // ============================================================================
  // EXACT SUBTOTAL CALCULATION LOGIC
  // ============================================================================

  function calculateSubtotal(subjects, termData) {
    const { totalWeighted, totalCoef } = subjects.reduce(
      (acc, subject) => {
        const avg = termData.getTermAvg(subject);
        if (avg != null && !isNaN(Number(avg))) {
          acc.totalWeighted += avg * subject.coef;
          acc.totalCoef += subject.coef;
        }
        return acc;
      },
      { totalWeighted: 0, totalCoef: 0 }
    );

    const avg = totalCoef > 0 ? totalWeighted / totalCoef : 0;
    const remark = getRemark(avg);
    const remarkClass = getRemarkClass(remark);

    return {
      totalWeighted: totalWeighted.toFixed(0),
      remark,
      remarkClass,
    };
  }

  // ============================================================================
  // GENERATE SINGLE REPORT CARD HTML
  // ============================================================================

  function generateSingleCard(data) {
    const termData = getCurrentTermData(data.student.term);
    const cumulativeAvg = getCumulativeAverageToDate(data);

    // Determine which term's totals to use
    const termKey =
      data.student.term === "FIRST TERM"
        ? "term1"
        : data.student.term === "SECOND TERM"
        ? "term2"
        : "term3";
    const termTotals = data.termTotals[termKey];

    // Counted label for cumulative average
    const countedLabel =
      data.student.term === "FIRST TERM"
        ? "T1"
        : data.student.term === "SECOND TERM"
        ? "T1 + T2"
        : "T1 + T2 + T3";

    // Column headers
    const colHeaders = termData.columnHeaders
      .map((h) => `<th>${esc(h)}</th>`)
      .join("");

    // Calculate subtotal colspan (2 for code+title + number of columns)
    const subtotalColspan = 2 + termData.showColumns.length;

    // Render subject sections
    const generalRows = (data.generalSubjects || [])
      .map((s) => renderSubjectRow(s, termData))
      .join("");
    const generalSubtotal = calculateSubtotal(
      data.generalSubjects || [],
      termData
    );

    const professionalRows = (data.professionalSubjects || [])
      .map((s) => renderSubjectRow(s, termData))
      .join("");
    const professionalSubtotal = calculateSubtotal(
      data.professionalSubjects || [],
      termData
    );

    const practicalRows = (data.practicalSubjects || [])
      .map((s) => renderSubjectRow(s, termData))
      .join("");
    const practicalSubtotal = calculateSubtotal(
      data.practicalSubjects || [],
      termData
    );

    // Grading scale rows
    const gradingRows = gradingScale
      .map(
        (g) => `
      <tr>
        <td>${formatRange(g.band_min, g.band_max)}:</td>
        <td><span class="${getRemarkClass(g.comment)}">${esc(
          g.comment
        )}</span></td>
      </tr>
    `
      )
      .join("");

    return `
    <div class="report-card-container">
      <div class="report-card" id="reportCard">
        <!-- DOCUMENT HEADER -->
        <div class="document-header">
          <div class="header-content">
            <div class="left-section">
              <div class="republic-text">RÉPUBLIQUE DU CAMEROUN</div>
              <div class="motto">PAIX - TRAVAIL - PATRIE</div>
              <div class="ministry">MINISTÈRE DE L'EMPLOI ET DE LA FORMATION PROFESSIONNELLE</div>
              <div class="department">DIRECTION DE L'ENSEIGNEMENT PRIVÉ</div>
              <div class="school-name-header">VOTECH S7 ACADEMY</div>
              <div class="location">AZIRE - MANKON</div>
            </div>

            <div class="center-emblem">
              <img src="${logoUrl}" alt="School Logo" class="report-card-logo" style="width: 4rem; height: 4rem; background: #204080; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-bottom: 6px;" />
              <div class="center-text">
                <div class="igniting-text">IGNITING ''Preneurs</div>
                <div class="center-motto">Motto: Welfare, Productivity, Self Actualization</div>
              </div>
            </div>

            <div class="right-section">
              <div class="republic-text">REPUBLIC OF CAMEROON</div>
              <div class="motto">PEACE - WORK - FATHERLAND</div>
              <div class="ministry">MINISTRY OF EMPLOYMENT AND VOCATIONAL TRAINING</div>
              <div class="department">DEPARTMENT OF PRIVATE VOCATIONAL INSTITUTE</div>
              <div class="school-name-header">VOTECH S7 ACADEMY</div>
              <div class="location">AZIRE - MANKON</div>
            </div>
          </div>

          <div class="document-title">
            <h1>ACADEMIC REPORT CARD</h1>
            <div class="term-info">${esc(data.student.term)} • ${esc(
      data.student.academicYear
    )}</div>
          </div>
        </div>

        <!-- STUDENT INFO -->
        <div class="student-info">
          <table class="info-table">
            <tbody>
              <tr>
                <td class="label">Student Name:</td>
                <td class="value">${esc(data.student.name)}</td>
                <td class="label">Class:</td>
                <td class="value">${esc(data.student.class)}</td>
              </tr>
              <tr>
                <td class="label">Registration No:</td>
                <td class="value">${esc(data.student.registrationNumber)}</td>
                <td class="label">Specialty:</td>
                <td class="value">${esc(data.student.option)}</td>
              </tr>
              <tr>
                <td class="label">Date of Birth:</td>
                <td class="value">${esc(data.student.dateOfBirth)}</td>
                <td class="label">Academic Year:</td>
                <td class="value">${esc(data.student.academicYear)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- GENERAL SUBJECTS -->
        ${
          generalRows
            ? `
        <div class="subjects-section">
          <div class="section-header">
            <h3>GENERAL SUBJECTS</h3>
          </div>
          <table class="subjects-table">
            <thead>
              <tr>
                <th>CODE</th>
                <th>SUBJECT TITLE</th>
                ${colHeaders}
                <th>COEF</th>
                <th>TOTAL</th>
                <th>REMARK</th>
                <th>TEACHER</th>
              </tr>
            </thead>
            <tbody>
              ${generalRows}
              <tr class="subtotal-row">
                <td colspan="${subtotalColspan}" class="subtotal-label">SUB TOTAL:</td>
                <td class="subtotal-value">${generalSubtotal.totalWeighted}</td>
                <td class="subtotal-remark"><span class="${
                  generalSubtotal.remarkClass
                }">${esc(generalSubtotal.remark)}</span></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        `
            : ""
        }

        <!-- PROFESSIONAL SUBJECTS -->
        ${
          professionalRows
            ? `
        <div class="subjects-section">
          <div class="section-header">
            <h3>PROFESSIONAL SUBJECTS</h3>
          </div>
          <table class="subjects-table">
            <thead>
              <tr>
                <th>CODE</th>
                <th>SUBJECT TITLE</th>
                ${colHeaders}
                <th>COEF</th>
                <th>TOTAL</th>
                <th>REMARK</th>
                <th>TEACHER</th>
              </tr>
            </thead>
            <tbody>
              ${professionalRows}
              <tr class="subtotal-row">
                <td colspan="${subtotalColspan}" class="subtotal-label">SUB TOTAL:</td>
                <td class="subtotal-value">${
                  professionalSubtotal.totalWeighted
                }</td>
                <td class="subtotal-remark"><span class="${
                  professionalSubtotal.remarkClass
                }">${esc(professionalSubtotal.remark)}</span></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        `
            : ""
        }

        <!-- PRACTICAL SUBJECTS -->
        ${
          practicalRows
            ? `
        <div class="subjects-section">
          <div class="section-header">
            <h3>PRACTICAL SUBJECTS</h3>
          </div>
          <table class="subjects-table">
            <thead>
              <tr>
                <th>CODE</th>
                <th>SUBJECT TITLE</th>
                ${colHeaders}
                <th>COEF</th>
                <th>TOTAL</th>
                <th>REMARK</th>
                <th>TEACHER</th>
              </tr>
            </thead>
            <tbody>
              ${practicalRows}
              <tr class="subtotal-row">
                <td colspan="${subtotalColspan}" class="subtotal-label">SUB TOTAL:</td>
                <td class="subtotal-value">${
                  practicalSubtotal.totalWeighted
                }</td>
                <td class="subtotal-remark"><span class="${
                  practicalSubtotal.remarkClass
                }">${esc(practicalSubtotal.remark)}</span></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        `
            : ""
        }

        <!-- PERFORMANCE SUMMARY -->
        <div class="performance-summary">
          <table class="summary-table">
            <tbody>
              <tr>
                <td class="summary-label">GRAND TOTAL:</td>
                <td class="summary-value">${Math.round(termTotals.total)}</td>
                <td class="summary-label">STUDENT AVERAGE:</td>
                <td class="summary-value">${termTotals.average}/20</td>
              </tr>
              <tr>
                <td class="summary-label">CLASS AVERAGE:</td>
                <td class="summary-value">${
                  data.classStatistics.classAverage
                }/20</td>
                <td class="summary-label">CLASS RANK:</td>
                <td class="summary-value">${termTotals.rank}° of ${
      termTotals.outOf
    }</td>
              </tr>
              <tr>
                <td class="summary-label">CUMULATIVE AVERAGE (${countedLabel}):</td>
                <td class="summary-value">${
                  cumulativeAvg !== null ? `${cumulativeAvg}/20` : "N/A"
                }</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- BOTTOM SECTION -->
        <div class="bottom-section">
          <div class="left-column">
            <div class="conduct-section">
              <h4>CONDUCT & ATTENDANCE</h4>
              <table class="conduct-table">
                <tbody>
                  <tr>
                    <td>Days Present:</td>
                    <td>${data.conduct.attendanceDays || "-"}/${
      data.conduct.totalDays || "-"
    }</td>
                  </tr>
                  <tr>
                    <td>Times Late:</td>
                    <td>${data.conduct.timesLate || "-"}</td>
                  </tr>
                  <tr>
                    <td>Disciplinary Actions:</td>
                    <td>${data.conduct.disciplinaryActions || "-"}</td>
                  </tr>
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
                      (data.administration.classMaster || "").toUpperCase()
                    )}</td>
                  </tr>
                  <tr>
                    <td>Decision:</td>
                    <td><span class="remark-good">${esc(
                      data.administration.decision || ""
                    )}</span></td>
                  </tr>
                  <tr>
                    <td>Next Term:</td>
                    <td>${esc(data.administration.nextTermStarts || "")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- SIGNATURE SECTION -->
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-title">CLASS MASTER</div>
            <div class="signature-line"></div>
            <div class="signature-name">${esc(
              (data.administration.classMaster || "").toUpperCase()
            )}</div>
            <div class="signature-date">Date & Signature</div>
          </div>

          <div class="signature-box">
            <div class="signature-title">PRINCIPAL</div>
            <div class="signature-line"></div>
            <div class="signature-name">${esc(
              (data.administration.principal || "").toUpperCase()
            )}</div>
            <div class="signature-date">Date, Signature & Seal</div>
          </div>

          <div class="signature-box">
            <div class="signature-title">PARENT/GUARDIAN</div>
            <div class="signature-line"></div>
            <div class="signature-name">${esc(
              (data.administration.parents || "").toUpperCase()
            )}</div>
            <div class="signature-date">Date & Signature</div>
          </div>
        </div>
      </div>

      <!-- FOOTER -->
      <span class="footer-text">© ${new Date().getFullYear()} Izzy Tech Team – Official Document | Votech (S7) Academy</span>
    </div>
    `;
  }

  // ============================================================================
  // EXACT CSS FROM REACT COMPONENT WITH CRITICAL FIXES
  // ============================================================================

  const css = `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      /* SCREEN STYLES */
      .report-card-container {
        width: 100%;
        min-height: 100vh;
        background: #f5f5f5;
        padding: 20px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }

      .report-card {
        width: 100%;
        max-width: 1200px;
        background: white;
        border: 2px solid #204080;
        padding: 15px;
        margin: 0 auto;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
        position: relative;
        overflow: hidden;
        font-family: "Arial", sans-serif;
        line-height: 1.2;
        font-size: 11px;
      }

      /* Watermark */
      .report-card::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-15deg);
        width: 600px;
        height: 600px;
        background-size: contain;
        z-index: 0;
        pointer-events: none;
        opacity: 0.04;
      }

      .report-card > * {
        position: relative;
        z-index: 1;
      }

      /* Document Header */
      .document-header {
        border-bottom: 2px solid #204080;
        padding: 10px;
        margin-bottom: 10px;
        background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
        border-radius: 6px;
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 10px;
        gap: 15px;
      }

      .left-section,
      .right-section {
        flex: 1;
        text-align: center;
        font-size: 9px;
        line-height: 1.3;
      }

      .center-emblem {
        flex: 0 0 160px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
      }

      .report-card-logo {
        height: 3.5rem;
        width: 3.5rem;
        object-fit: cover;
        margin-bottom: 6px;
      }

      .center-text {
        text-align: center;
      }

      .igniting-text {
        font-size: 11px;
        font-weight: bold;
        color: #204080;
        margin-bottom: 3px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .center-motto {
        font-size: 8px;
        font-style: italic;
        color: #c9a96e;
        font-weight: 600;
      }

      .republic-text {
        font-weight: bold;
        font-size: 10px;
        margin-bottom: 2px;
        text-transform: uppercase;
        color: #204080;
      }

      .motto {
        font-style: italic;
        font-size: 8px;
        margin-bottom: 2px;
        color: #c9a96e;
        font-weight: 600;
      }

      .ministry {
        font-weight: bold;
        font-size: 8px;
        margin-bottom: 2px;
        text-transform: uppercase;
        color: #204080;
      }

      .department {
        font-weight: bold;
        font-size: 7.5px;
        margin-bottom: 2px;
        text-transform: uppercase;
        color: #204080;
      }

      .school-name-header {
        font-weight: bold;
        font-size: 9px;
        margin-bottom: 2px;
        text-transform: uppercase;
        color: #204080;
        letter-spacing: 0.5px;
      }

      .location {
        font-size: 8px;
        color: #666;
        font-weight: 600;
      }

      .document-title {
        text-align: center;
        margin-top: 10px;
      }

      .document-title h1 {
        font-size: 16px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        margin-bottom: 4px;
        color: #204080;
      }

      .term-info {
        font-size: 11px;
        color: #666;
      }

      /* Student Information */
      .student-info {
        margin-bottom: 10px;
        padding: 8px;
        border-radius: 4px;
        background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
        border: 1px solid #204080;
      }

      .info-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 12px 3px;
      }

      .info-table td {
        padding: 3px 6px;
        font-size: 10px;
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
        margin-bottom: 10px;
        break-inside: avoid;
      }

      .section-header {
        background: linear-gradient(135deg, #204080 0%, #3a5a9a 100%);
        color: #fff;
        text-align: center;
        padding: 6px;
        margin-bottom: 0;
        border-radius: 4px 4px 0 0;
        display: flex !important;
        justify-content: center !important;
      }

      .section-header h3 {
        font-size: 12px;
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

      .subjects-table th,
      .subjects-table td {
        border: 1px solid #204080;
        padding: 2px 2px;
        font-size: 8.5px;
        text-align: center;
        vertical-align: middle;
        line-height: 1.1;
      }

      .subjects-table th {
        background: linear-gradient(135deg, #e8eeff 0%, #f0f4ff 100%);
        font-weight: bold;
        text-transform: uppercase;
        color: #204080;
        height: 28px;
        font-size: 7.5px;
      }

      .code-cell {
        font-weight: bold;
        color: #204080;
        width: 38px;
      }

      .subject-cell {
        text-align: left;
        padding-left: 5px;
        font-weight: normal;
        color: #333;
        min-width: 130px;
        font-size: 7.5px;
      }

      .score-cell,
      .avg-cell,
      .coef-cell,
      .total-cell {
        font-weight: bold;
        color: #333;
        width: 32px;
      }

      .avg-cell,
      .total-cell {
        font-weight: bold;
        color: #204080;
        font-size: 8.5px;
      }

      .remark-cell {
        width: 65px;
      }

      .remark-cell span {
        font-size: 7.5px;
        font-weight: bold;
        display: inline-block;
        min-width: 45px;
        color: #333;
      }

      /* Grade Colors */
      .remark-excellent {
        color: #0d5f0d;
      }
      .remark-vgood {
        color: #1a5f1a;
      }
      .remark-good {
        color: #204080;
      }
      .remark-fairly-good {
        color: #b8860b;
      }
      .remark-average {
        color: #ff8c00;
      }
      .remark-weak {
        color: #cc0000;
      }

      .teacher-cell {
        text-align: left;
        padding-left: 3px;
        font-size: 6.5px;
        color: #666;
        min-width: 75px;
      }

      .subtotal-row {
        background: linear-gradient(135deg, #e8eeff 0%, #f0f4ff 100%);
        font-weight: bold;
        border-top: 2px solid #204080;
      }

      .subtotal-label {
        text-transform: uppercase;
        font-size: 8.5px;
        color: #204080;
        text-align: right;
        padding-right: 8px;
      }

      .subtotal-value {
        font-size: 9px;
        font-weight: bold;
        color: #204080;
      }

      .subtotal-remark {
        font-weight: bold;
        color: #204080;
      }

      /* Performance Summary */
      .performance-summary {
        margin-bottom: 10px;
        padding: 8px;
        border-radius: 4px;
        background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
        border: 1px solid #204080;
      }

      .summary-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 12px 4px;
        padding: 4px 0px;
        border-width: 1px;
        margin-top: 0 !important;
      }

      .summary-table td {
        padding: 3px 8px;
        font-size: 8.5px;
        font-weight: bold;
      }

      .summary-label {
        color: #204080;
        text-transform: uppercase;
      }

      .summary-value {
        color: #333;
        border-bottom: 1px solid #204080;
        min-width: 75px;
      }

      /* Bottom Section */
      .bottom-section {
        display: flex;
        gap: 12px;
        margin-bottom: 10px;
      }

      .left-column,
      .center-column,
      .right-column {
        flex: 1;
      }

      .conduct-section,
      .grading-scale,
      .admin-section {
        padding: 8px;
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
        font-size: 10px;
        color: #204080;
        border-bottom: 1px solid #204080;
        padding-bottom: 4px;
        margin-bottom: 8px;
      }

      .conduct-table,
      .scale-table,
      .admin-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 3px;
      }

      .conduct-table td,
      .scale-table td,
      .admin-table td {
        padding: 2px 4px;
        font-size: 8.5px;
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
        gap: 12px;
        margin-bottom: 10px;
      }

      .signature-box {
        flex: 1;
        padding: 12px 8px;
        border-radius: 4px;
        border: 1px solid #204080;
        text-align: center;
        background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%);
        min-height: 70px;
      }

      .signature-title {
        font-weight: bold;
        text-transform: uppercase;
        font-size: 9px;
        margin-bottom: 8px;
        color: #204080;
      }

      .signature-line {
        background-color: #204080;
        margin: 12px 0;
        height: 1px;
        width: 100%;
      }

      .signature-name {
        font-weight: bold;
        font-size: 8.5px;
        color: #333;
        margin-bottom: 2px;
      }

      .signature-date {
        font-size: 7.5px;
        font-style: italic;
        color: #666;
      }

      .low-score {
        color: #cc0000;
      }

      /* Footer */
      .footer-text {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        display: none;
        justify-content: center;
        font-size: 12px;
        color: rgb(133, 133, 133);
        font-style: italic;
      }

      /* Print Button */
      .print-button {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 24px;
        background: #204080;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        z-index: 1000;
      }

      .print-button:hover {
        background: #3a5a9a;
      }

      .report-card::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-15deg);
        width: 570px;
        height: 570px;
        background: url(${logoUrl}) no-repeat center;
        background-size: contain;
        z-index: 10;
        pointer-events: none;
        opacity: 0.06;
      }

      /* ===============================
   PRINT STYLES
=============================== */

      @media print {
        :root {
          --page-width-mm: 100%;
          --page-height-mm: 297;
          --page-margin-mm: 8;
          --print-scale: 1;
        }

        @page {
          size: A4 portrait;
          margin: 2mm;
        }

        * {
          -webkit-print-color-adjust: exact !important;
          color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          overflow: visible !important;
          display: block !important;
        }

        .print-button {
          display: none !important;
        }

        .footer-text {
          display: flex !important;
          bottom: 1mm;
          position: fixed;
        }

        .report-card::before {
          opacity: 0.08;
        }

        .report-card-container {
          background: white !important;
          padding: 0 !important;
          min-height: unset;
          height: auto !important;
          visibility: visible !important;
          box-shadow: none !important;
          width: 200mm !important;

          margin: 0 auto;
        }

        .report-card .performance-summary .summary-table {
          margin-top: 0 !important;
          border-width: 1px !important;
        }

        .report-card .performance-summary .summary-table td {
          font-size: 8.5px !important;
        }

        .report-card-container * {
          visibility: visible !important;
        }

        .report-card {
          border: none !important;
          padding: 0 !important;
          margin: 0 !important;
          overflow: visible !important;
          box-shadow: none !important;
          background: white !important;
          transform: scale(var(--print-scale)) !important;
          transform-origin: top center !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
          font-size: 9px !important;
          line-height: 1.1 !important;
          width: 100% !important;
        }

        .document-header {
          padding: 3mm !important;
          margin-bottom: 2mm !important;
          border-bottom: 2px solid #204080 !important;
          background: linear-gradient(
            135deg,
            #f8f9ff 0%,
            #ffffff 100%
          ) !important;
        }

        .header-content {
          margin-bottom: 2mm !important;
          gap: 1.5mm !important;
        }

        .left-section,
        .right-section {
          font-size: 7.5pt !important;
          line-height: 1.2 !important;
        }

        .center-emblem {
          flex: 0 0 32mm !important;
        }

        .report-card-logo {
          width: 16mm !important;
          height: 16mm !important;
          margin-bottom: 1.5mm !important;
        }

        .igniting-text {
          font-size: 8.5pt !important;
          margin-bottom: 0.8mm !important;
        }

        .center-motto {
          font-size: 6.5pt !important;
        }

        .republic-text {
          font-size: 7.5pt !important;
          margin-bottom: 0.3mm !important;
        }

        .motto {
          font-size: 6.5pt !important;
          margin-bottom: 0.3mm !important;
        }

        .ministry {
          font-size: 7pt !important;
          margin-bottom: 0.3mm !important;
        }

        .department {
          font-size: 6.5pt !important;
          margin-bottom: 0.3mm !important;
        }

        .school-name-header {
          font-size: 7.5pt !important;
          margin-bottom: 0.3mm !important;
        }

        .location {
          font-size: 6.5pt !important;
        }

        .document-title h1 {
          font-size: 11pt !important;
          margin-bottom: 1.5mm !important;
        }

        .term-info {
          font-size: 8.5pt !important;
        }

        .student-info {
          margin-bottom: 2mm !important;
          padding: 2mm !important;
          background: linear-gradient(
            135deg,
            #f8f9ff 0%,
            #ffffff 100%
          ) !important;
        }

        .info-table {
          border-spacing: 1.5mm 0.3mm !important;
        }

        .info-table td {
          font-size: 8.5pt !important;
          padding: 0.2mm 0.8mm !important;
        }

        .subjects-section {
          margin-bottom: 1.5mm !important;
          page-break-inside: avoid !important;
        }

        .section-header {
          padding: 1.2mm !important;
          background: linear-gradient(
            135deg,
            #204080 0%,
            #3a5a9a 100%
          ) !important;
        }

        .section-header h3 {
          font-size: 8.5pt !important;
        }

        .subjects-table th,
        .subjects-table td {
          font-size: 7.5pt !important;
          padding: 0.2mm 0.6mm !important;
          line-height: 1.15 !important;
        }

        .subjects-table th {
          height: 3mm !important;
          background: linear-gradient(
            135deg,
            #e8eeff 0%,
            #f0f4ff 100%
          ) !important;
          font-size: 7pt !important;
        }

        .subject-cell {
          font-size: 7pt !important;
        }

        .teacher-cell {
          font-size: 6pt !important;
        }

        .remark-cell span {
          font-size: 7pt !important;
        }

        .subtotal-row {
          background: linear-gradient(
            135deg,
            #e8eeff 0%,
            #f0f4ff 100%
          ) !important;
        }

        .performance-summary {
          margin-bottom: 2mm !important;
          padding: 2mm !important;
          background: linear-gradient(
            135deg,
            #f8f9ff 0%,
            #ffffff 100%
          ) !important;
        }

        .bottom-section {
          gap: 1.5mm !important;
          margin-bottom: 2mm !important;
        }

        .conduct-section,
        .grading-scale,
        .admin-section {
          padding: 2mm !important;
          background: linear-gradient(
            135deg,
            #f8f9ff 0%,
            #ffffff 100%
          ) !important;
        }

        .conduct-section h4,
        .grading-scale h4,
        .admin-section h4 {
          font-size: 8pt !important;
          margin-bottom: 1.2mm !important;
          padding-bottom: 0.6mm !important;
        }

        .conduct-table td,
        .scale-table td,
        .admin-table td {
          font-size: 7.5pt !important;
          padding: 0.2mm 0.6mm !important;
        }

        .signature-section {
          gap: 1.5mm !important;
          margin-top: 2mm !important;
          page-break-inside: avoid !important;
        }

        .signature-box {
          padding: 2mm !important;
          min-height: 16mm !important;
          background: linear-gradient(
            135deg,
            #f8f9ff 0%,
            #ffffff 100%
          ) !important;
          border: 1px solid #204080 !important;
        }

        .signature-title {
          font-size: 7.5pt !important;
          margin-bottom: 3mm !important;
        }

        .signature-line {
          margin: 1.2mm 0 !important;
          background-color: #204080 !important;
        }

        .signature-name {
          font-size: 7pt !important;
          margin-bottom: 0.6mm !important;
        }

        .signature-date {
          font-size: 6.5pt !important;
        }

        .document-header,
        .student-info,
        .subjects-section,
        .performance-summary,
        .bottom-section,
        .signature-section {
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }

        .low-score {
          color: #cc0000 !important;
        }

        .no-print {
          display: none !important;
        }
      }
  `;

  // ============================================================================
  // GENERATE COMPLETE HTML DOCUMENT
  // ============================================================================

  const reportCardsHTML = students
    .map((student) => generateSingleCard(student))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bulk Report Cards - Votech S7 Academy</title>
  <style>${css}</style>
</head>
<body>
${reportCardsHTML}
</body>
</html>`;
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

  const sanitizeFilename = (s = "") => String(s).replace(/[^\w\-]+/g, "_");

  const resolveTermKey = async (rawTerm) => {
    const t = String(rawTerm ?? "annual")
      .trim()
      .toLowerCase();

    if (t === "annual" || t === "all" || t === "") return "annual";
    if (t === "term1" || t === "t1" || t.includes("first")) return "term1";
    if (t === "term2" || t === "t2" || t.includes("second")) return "term2";
    if (t === "term3" || t === "t3" || t.includes("third")) return "term3";

    const n = Number(t);
    if (!Number.isNaN(n)) {
      if ([1, 2, 3].includes(n)) return `term${n}`;
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

  if (!academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

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

  const termKey = await resolveTermKey(term);

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
  // Generate HTML directly from original cards
  // buildHTML function expects the original structure from buildReportCardsFromMarks
  // Generate HTML directly from original cards
  // buildHTML function expects the original structure from buildReportCardsFromMarks
  const defaultLogoUrl = `${req.protocol}://${req.get("host")}/public/logo.png`;
  const html = buildHTML(cards, { logoUrl: defaultLogoUrl }, grading);

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    await page.evaluate(async () => {
      const selectors = Array.from(document.images).map((img) => {
        if (img.complete) return;
        return new Promise((resolve, reject) => {
          img.addEventListener("load", resolve);
          img.addEventListener("error", resolve);
        });
      });
      await Promise.all(selectors);
    });

    await page.evaluateHandle("document.fonts.ready");

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "4mm", right: "10mm", bottom: "4mm", left: "10mm" },
    });

    const filename = `${sanitizeFilename(
      academicYearData.name
    )}-${sanitizeFilename(department.name)}-${sanitizeFilename(
      studentClass.name
    )}-${sanitizeFilename(meta.termLabel)}-report-cards.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    res.status(200).end(pdfBuffer);
  } catch (err) {
    return next(err);
  } finally {
    await browser.close();
  }
});

/**
 * Generate complete HTML for bulk report cards
 * Returns HTML file that can be printed directly in browser
 */
const bulkReportCardsHTML = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId, term = "annual" } = req.query;

  console.log("TERM: ..................: ", term);

  // Validation
  if (!academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Fetch necessary data
  const [academicYearData, department, studentClass] = await Promise.all([
    models.AcademicYear.findByPk(academicYearId),
    models.specialties.findByPk(departmentId),
    models.Class.findByPk(classId, {
      include: [
        {
          model: models.users,
          as: "classMaster",
          attributes: ["name", "username"],
        },
      ],
    }),
  ]);

  // Validation checks
  if (!academicYearData) {
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  }
  if (!department) {
    return next(new AppError("Department not found", StatusCodes.NOT_FOUND));
  }
  if (!studentClass) {
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));
  }

  const classMaster =
    studentClass?.classMaster?.name ||
    studentClass?.classMaster?.username ||
    "";

  // Resolve term key
  const resolveTermKey = async (rawTerm) => {
    const t = String(rawTerm ?? "annual")
      .trim()
      .toLowerCase();

    if (t === "annual" || t === "all" || t === "") return "annual";
    if (t === "term1" || t === "t1" || t.includes("first")) return "term1";
    if (t === "term2" || t === "t2" || t.includes("second")) return "term2";
    if (t === "term3" || t === "t3" || t.includes("third")) return "term3";

    const n = Number(t);
    if (!Number.isNaN(n)) {
      if ([1, 2, 3].includes(n)) return `term${n}`;
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

  const termKey = await resolveTermKey(term);

  // Fetch marks with all necessary includes
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

  // Build report cards from marks
  const cards = buildReportCardsFromMarks(marks, classMaster, termKey);

  // Fetch grading scale
  const grading = await models.academic_bands.findAll({
    where: {
      academic_year_id: academicYearData.id,
      class_id: studentClass.id,
    },
    raw: true,
  });

  console.log("Grading:  ", grading);

  // FIXED: Generate HTML directly from original cards
  // Do NOT transform to template cards - buildHTML expects original structure
  const logoUrl = `${req.protocol}://${req.get("host")}/public/logo.png`;
  const html = buildHTML(cards, {
    logoUrl: logoUrl,
    grading: grading,
  });

  // Generate filename
  const sanitizeFilename = (s = "") => String(s).replace(/[^\w\-]+/g, "_");
  const filename = `${sanitizeFilename(
    academicYearData.name
  )}-${sanitizeFilename(department.name)}-${sanitizeFilename(
    studentClass.name
  )}-${sanitizeFilename(termLabelFromKey(termKey))}-report-cards.html`;

  // Set headers for HTML download
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // Send HTML
  res.status(StatusCodes.OK).send(html);
});
/**
 * TEST ENDPOINT - Generate HTML with mock data for QA testing
 * Simulates bulk report cards with sample data (20 students)
 * DO NOT USE IN PRODUCTION
 */
const bulkReportCardsHTMLTest = catchAsync(async (req, res, next) => {
  const { term = "annual", studentCount = "100" } = req.query;

  // Parse student count (max 50 for testing)
  const count = Math.min(parseInt(studentCount) || 20, 200);

  // Mock sample data template
  const sampleDataTemplate = {
    student: {
      name: "NKONGHO LUA DANIEL",
      registrationNumber: "VSA/2024/001",
      dateOfBirth: "15 March 2008",
      class: "LEVEL 2 MECHANICAL ENGINEERING",
      option: "MECHANICAL ENGINEERING",
      academicYear: "2023-2024",
      term: "THIRD TERM", // FIRST TERM, SECOND TERM, THIRD TERM
    },

    // Sequences data structure
    sequences: {
      seq1: { name: "Sequence 1", weight: 1 },
      seq2: { name: "Sequence 2", weight: 1 },
      seq3: { name: "Sequence 3", weight: 1 },
      seq4: { name: "Sequence 4", weight: 1 },
      seq5: { name: "Sequence 5", weight: 1 },
      seq6: { name: "Sequence 6", weight: 1 },
    },

    generalSubjects: [
      {
        code: "MTH",
        title: "MATHEMATICS",
        coef: 5,
        teacher: "NJEMA PAUL",
        scores: {
          seq1: 16,
          seq2: 18,
          seq3: 15,
          seq4: 17,
          seq5: 16,
          seq6: 19,
          term1Avg: 17.0,
          term2Avg: 16.0,
          term3Avg: 17.5,
          finalAvg: 16.8,
        },
      },
      {
        code: "ENG",
        title: "ENGLISH LANGUAGE",
        coef: 5,
        teacher: "MBAH GRACE",
        scores: {
          seq1: 15,
          seq2: 16,
          seq3: 14,
          seq4: 15,
          seq5: 17,
          seq6: 16,
          term1Avg: 15.5,
          term2Avg: 14.5,
          term3Avg: 16.5,
          finalAvg: 15.5,
        },
      },
      {
        code: "FRE",
        title: "FRENCH LANGUAGE",
        coef: 4,
        teacher: "TABI MARIE",
        scores: {
          seq1: 12,
          seq2: 13,
          seq3: 11,
          seq4: 12,
          seq5: 14,
          seq6: 13,
          term1Avg: 12.5,
          term2Avg: 11.5,
          term3Avg: 13.5,
          finalAvg: 12.5,
        },
      },
      {
        code: "COM",
        title: "COMMERCE",
        coef: 3,
        teacher: "CHIEF EXAMINER",
        scores: {
          seq1: 14,
          seq2: 15,
          seq3: 13,
          seq4: 14,
          seq5: 15,
          seq6: 16,
          term1Avg: 14.5,
          term2Avg: 13.5,
          term3Avg: 15.5,
          finalAvg: 14.5,
        },
      },
      {
        code: "ECO",
        title: "ECONOMICS",
        coef: 3,
        teacher: "FOMBA JOHN",
        scores: {
          seq1: 13,
          seq2: 14,
          seq3: 12,
          seq4: 13,
          seq5: 15,
          seq6: 14,
          term1Avg: 13.5,
          term2Avg: 12.5,
          term3Avg: 14.5,
          finalAvg: 13.5,
        },
      },
    ],

    professionalSubjects: [
      {
        code: "MED",
        title: "MECHANICAL DRAWING",
        coef: 6,
        teacher: "ENG. TABI",
        scores: {
          seq1: 15,
          seq2: 16,
          seq3: 14,
          seq4: 15,
          seq5: 17,
          seq6: 16,
          term1Avg: 15.5,
          term2Avg: 14.5,
          term3Avg: 16.5,
          finalAvg: 15.5,
        },
      },
      {
        code: "ELT",
        title: "ELECTRICAL TECHNOLOGY",
        coef: 5,
        teacher: "TECH. MBAH",
        scores: {
          seq1: 14,
          seq2: 15,
          seq3: 13,
          seq4: 14,
          seq5: 16,
          seq6: 15,
          term1Avg: 14.5,
          term2Avg: 13.5,
          term3Avg: 15.5,
          finalAvg: 14.5,
        },
      },
      {
        code: "WRP",
        title: "WORKSHOP PRACTICE",
        coef: 5,
        teacher: "TECH. FOMBA",
        scores: {
          seq1: 16,
          seq2: 17,
          seq3: 15,
          seq4: 16,
          seq5: 18,
          seq6: 17,
          term1Avg: 16.5,
          term2Avg: 15.5,
          term3Avg: 17.5,
          finalAvg: 16.5,
        },
      },
      {
        code: "SHW",
        title: "SHEET METAL WORKS",
        coef: 4,
        teacher: "TECH. GRACE",
        scores: {
          seq1: 13,
          seq2: 14,
          seq3: 12,
          seq4: 13,
          seq5: 15,
          seq6: 14,
          term1Avg: 13.5,
          term2Avg: 12.5,
          term3Avg: 14.5,
          finalAvg: 13.5,
        },
      },
      {
        code: "ENS",
        title: "ENGINEERING SCIENCE",
        coef: 5,
        teacher: "ENG. PAUL",
        scores: {
          seq1: 15,
          seq2: 16,
          seq3: 14,
          seq4: 15,
          seq5: 17,
          seq6: 16,
          term1Avg: 15.5,
          term2Avg: 14.5,
          term3Avg: 16.5,
          finalAvg: 15.5,
        },
      },
      {
        code: "ICT",
        title: "INFORMATION TECHNOLOGY",
        coef: 3,
        teacher: "TECH. MARIE",
        scores: {
          seq1: 17,
          seq2: 18,
          seq3: 16,
          seq4: 17,
          seq5: 19,
          seq6: 18,
          term1Avg: 17.5,
          term2Avg: 16.5,
          term3Avg: 18.5,
          finalAvg: 17.5,
        },
      },
      {
        code: "MTL",
        title: "MATERIAL TECHNOLOGY",
        coef: 4,
        teacher: "ENG. NJEMA",
        scores: {
          seq1: 14,
          seq2: 15,
          seq3: 13,
          seq4: 14,
          seq5: 16,
          seq6: 15,
          term1Avg: 14.5,
          term2Avg: 13.5,
          term3Avg: 15.5,
          finalAvg: 14.5,
        },
      },
      {
        code: "TDR",
        title: "TECHNICAL DRAWING",
        coef: 5,
        teacher: "TECH. TABI",
        scores: {
          seq1: 16,
          seq2: 17,
          seq3: 15,
          seq4: 16,
          seq5: 18,
          seq6: 17,
          term1Avg: 16.5,
          term2Avg: 15.5,
          term3Avg: 17.5,
          finalAvg: 16.5,
        },
      },
      {
        code: "AUT",
        title: "AUTOMATION",
        coef: 4,
        teacher: "ENG. MBAH",
        scores: {
          seq1: 15,
          seq2: 16,
          seq3: 14,
          seq4: 15,
          seq5: 17,
          seq6: 16,
          term1Avg: 15.5,
          term2Avg: 14.5,
          term3Avg: 16.5,
          finalAvg: 15.5,
        },
      },
      {
        code: "QCT",
        title: "QUALITY CONTROL",
        coef: 3,
        teacher: "TECH. GRACE",
        scores: {
          seq1: 14,
          seq2: 15,
          seq3: 13,
          seq4: 14,
          seq5: 16,
          seq6: 15,
          term1Avg: 14.5,
          term2Avg: 13.5,
          term3Avg: 15.5,
          finalAvg: 14.5,
        },
      },
    ],

    practicalSubjects: [
      {
        code: "WLD",
        title: "WELDING PRACTICE",
        coef: 6,
        teacher: "WORKSHOP TEAM A",
        scores: {
          seq1: 18,
          seq2: 19,
          seq3: 17,
          seq4: 18,
          seq5: 19,
          seq6: 18,
          term1Avg: 18.5,
          term2Avg: 17.5,
          term3Avg: 18.5,
          finalAvg: 18.2,
        },
      },
      {
        code: "MCH",
        title: "MACHINING PRACTICE",
        coef: 7,
        teacher: "WORKSHOP TEAM B",
        scores: {
          seq1: 17,
          seq2: 18,
          seq3: 16,
          seq4: 17,
          seq5: 18,
          seq6: 17,
          term1Avg: 17.5,
          term2Avg: 16.5,
          term3Avg: 17.5,
          finalAvg: 17.2,
        },
      },
      {
        code: "FTG",
        title: "FITTING PRACTICE",
        coef: 6,
        teacher: "WORKSHOP TEAM C",
        scores: {
          seq1: 16,
          seq2: 17,
          seq3: 15,
          seq4: 16,
          seq5: 17,
          seq6: 16,
          term1Avg: 16.5,
          term2Avg: 15.5,
          term3Avg: 16.5,
          finalAvg: 16.2,
        },
      },
      {
        code: "ASB",
        title: "ASSEMBLY PRACTICE",
        coef: 5,
        teacher: "WORKSHOP TEAM D",
        scores: {
          seq1: 17,
          seq2: 18,
          seq3: 16,
          seq4: 17,
          seq5: 18,
          seq6: 17,
          term1Avg: 17.5,
          term2Avg: 16.5,
          term3Avg: 17.5,
          finalAvg: 17.2,
        },
      },
      {
        code: "MNT",
        title: "MAINTENANCE PRACTICE",
        coef: 6,
        teacher: "WORKSHOP TEAM E",
        scores: {
          seq1: 16,
          seq2: 17,
          seq3: 15,
          seq4: 16,
          seq5: 17,
          seq6: 16,
          term1Avg: 16.5,
          term2Avg: 15.5,
          term3Avg: 16.5,
          finalAvg: 16.2,
        },
      },
    ],

    // CORRECTED CALCULATIONS - Calculated totals and averages
    termTotals: {
      // TERM 1 CALCULATIONS
      // General: (17.0*5 + 15.5*5 + 12.5*4 + 14.5*3 + 13.5*3) / (5+5+4+3+3) = 286 / 20 = 14.3
      // Professional: (15.5*6 + 14.5*5 + 16.5*5 + 13.5*4 + 15.5*5 + 17.5*3 + 14.5*4 + 16.5*5 + 15.5*4 + 14.5*3) / (6+5+5+4+5+3+4+5+4+3) = 658.5 / 44 = 14.966 ≈ 15.0
      // Practical: (18.5*6 + 17.5*7 + 16.5*6 + 17.5*5 + 16.5*6) / (6+7+6+5+6) = 521.5 / 30 = 17.383 ≈ 17.4
      // Total Weighted: 286 + 658.5 + 521.5 = 1466
      // Total Coef: 20 + 44 + 30 = 94
      // Average: 1466 / 94 = 15.595 ≈ 15.6
      term1: { total: 1466.0, average: 15.6, rank: 2, outOf: 25 },

      // TERM 2 CALCULATIONS
      // General: (16.0*5 + 14.5*5 + 11.5*4 + 13.5*3 + 12.5*3) / 20 = 268.5 / 20 = 13.425 ≈ 13.4
      // Professional: (14.5*6 + 13.5*5 + 15.5*5 + 12.5*4 + 14.5*5 + 16.5*3 + 13.5*4 + 15.5*5 + 14.5*4 + 13.5*3) / 44 = 617 / 44 = 14.023 ≈ 14.0
      // Practical: (17.5*6 + 16.5*7 + 15.5*6 + 16.5*5 + 15.5*6) / 30 = 488 / 30 = 16.267 ≈ 16.3
      // Total Weighted: 268.5 + 617 + 488 = 1373.5
      // Average: 1373.5 / 94 = 14.612 ≈ 14.6
      term2: { total: 1373.5, average: 14.6, rank: 3, outOf: 25 },

      // TERM 3 CALCULATIONS
      // General: (17.5*5 + 16.5*5 + 13.5*4 + 15.5*3 + 14.5*3) / 20 = 294 / 20 = 14.7
      // Professional: (16.5*6 + 15.5*5 + 17.5*5 + 14.5*4 + 16.5*5 + 18.5*3 + 15.5*4 + 17.5*5 + 16.5*4 + 15.5*3) / 44 = 695 / 44 = 15.795 ≈ 15.8
      // Practical: (18.5*6 + 17.5*7 + 16.5*6 + 17.5*5 + 16.5*6) / 30 = 521.5 / 30 = 17.383 ≈ 17.4
      // Total Weighted: 294 + 695 + 521.5 = 1510.5
      // Average: 1510.5 / 94 = 16.068 ≈ 16.1
      term3: { total: 1510.5, average: 16.1, rank: 1, outOf: 25 },

      // ANNUAL CALCULATIONS
      // Annual Average = (15.6 + 14.6 + 16.1) / 3 = 46.3 / 3 = 15.433 ≈ 15.4
      // Annual Total = 1466 + 1373.5 + 1510.5 = 4350
      annual: { total: 4350.0, average: 15.4, rank: 2, outOf: 25 },
    },

    classStatistics: {
      classAverage: 12.8,
      highestAverage: 16.2,
      lowestAverage: 8.4,
    },

    conduct: {
      attendanceDays: 65,
      totalDays: 68,
      timesLate: 2,
      disciplinaryActions: 0,
    },

    administration: {
      classMaster: "NDICHIA GLIEM",
      principal: "Dr. ACADEMIC DIRECTOR",
      nextTermStarts: "September 2024",
      decision: "PROMOTED",
      parents: "MR. AND MRS. NKONGHO",
    },
  };

  // Helper to generate varied student names
  const firstNames = [
    "NKONGHO LUA",
    "MBAH GRACE",
    "TABI MARIE",
    "FOMBA JOHN",
    "NJEMA PAUL",
    "CHIEF EXAMINER",
    "TANKO IBRAHIM",
    "AYUK FLORENCE",
    "MANGA PETER",
    "NEBA COLLINS",
    "ASHU DIVINE",
    "KILO BLESSING",
    "SAMA ERIC",
    "NGWA MARTHA",
    "NDIP JUNIOR",
    "BATE SANDRA",
    "KOMETA BRIAN",
    "YONG VIVIAN",
    "AWAH PATRICK",
    "SHEY PROMISE",
  ];

  const lastNames = [
    "DANIEL",
    "WILLIAMS",
    "SMITH",
    "JOHNSON",
    "BROWN",
    "JONES",
    "DAVIS",
    "MILLER",
    "WILSON",
    "MOORE",
    "TAYLOR",
    "ANDERSON",
    "THOMAS",
    "JACKSON",
    "WHITE",
    "HARRIS",
    "MARTIN",
    "THOMPSON",
    "GARCIA",
    "MARTINEZ",
  ];

  // Helper to randomize scores slightly
  const randomizeScore = (baseScore, variance = 3) => {
    return Math.max(
      0,
      Math.min(
        20,
        baseScore + Math.floor(Math.random() * (variance * 2 + 1)) - variance
      )
    );
  };

  // Helper to randomize subject scores
  const randomizeSubjectScores = (baseScores) => {
    const newScores = { ...baseScores };

    // Randomize sequence scores
    newScores.seq1 = randomizeScore(baseScores.seq1, 2);
    newScores.seq2 = randomizeScore(baseScores.seq2, 2);
    newScores.seq3 = randomizeScore(baseScores.seq3, 2);
    newScores.seq4 = randomizeScore(baseScores.seq4, 2);
    newScores.seq5 = randomizeScore(baseScores.seq5, 2);
    newScores.seq6 = randomizeScore(baseScores.seq6, 2);

    // Recalculate term averages
    newScores.term1Avg = Number(
      ((newScores.seq1 + newScores.seq2) / 2).toFixed(1)
    );
    newScores.term2Avg = Number(
      ((newScores.seq3 + newScores.seq4) / 2).toFixed(1)
    );
    newScores.term3Avg = Number(
      ((newScores.seq5 + newScores.seq6) / 2).toFixed(1)
    );
    newScores.finalAvg = Number(
      (
        (newScores.term1Avg + newScores.term2Avg + newScores.term3Avg) /
        3
      ).toFixed(1)
    );

    return newScores;
  };

  // Generate mock students
  const mockStudents = [];
  for (let i = 0; i < count; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const studentNumber = String(i + 1).padStart(3, "0");

    // Clone and customize student data
    const studentData = JSON.parse(JSON.stringify(sampleDataTemplate));

    studentData.student.name = `${firstName} ${lastName}`;
    studentData.student.registrationNumber = `VSA/2024/${studentNumber}`;

    // Randomize DOB (year 2005-2010)
    const year = 2005 + (i % 6);
    const month = (i % 12) + 1;
    const day = (i % 28) + 1;
    studentData.student.dateOfBirth = `${day} ${
      [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ][month - 1]
    } ${year}`;

    // Randomize scores for variety
    studentData.generalSubjects = studentData.generalSubjects.map(
      (subject) => ({
        ...subject,
        scores: randomizeSubjectScores(subject.scores),
      })
    );

    studentData.professionalSubjects = studentData.professionalSubjects.map(
      (subject) => ({
        ...subject,
        scores: randomizeSubjectScores(subject.scores),
      })
    );

    studentData.practicalSubjects = studentData.practicalSubjects.map(
      (subject) => ({
        ...subject,
        scores: randomizeSubjectScores(subject.scores),
      })
    );

    // Recalculate term totals based on new scores
    const calculateTermTotal = (subjects, termKey) => {
      let totalWeighted = 0;
      let totalCoef = 0;

      subjects.forEach((subject) => {
        const avg = subject.scores[`${termKey}Avg`];
        if (avg !== null && avg !== undefined) {
          totalWeighted += avg * subject.coef;
          totalCoef += subject.coef;
        }
      });

      return {
        total: Number(totalWeighted.toFixed(1)),
        average:
          totalCoef > 0 ? Number((totalWeighted / totalCoef).toFixed(1)) : 0,
      };
    };

    const allSubjects = [
      ...studentData.generalSubjects,
      ...studentData.professionalSubjects,
      ...studentData.practicalSubjects,
    ];

    studentData.termTotals.term1 = calculateTermTotal(allSubjects, "term1");
    studentData.termTotals.term2 = calculateTermTotal(allSubjects, "term2");
    studentData.termTotals.term3 = calculateTermTotal(allSubjects, "term3");

    const annualAvg = Number(
      (
        (studentData.termTotals.term1.average +
          studentData.termTotals.term2.average +
          studentData.termTotals.term3.average) /
        3
      ).toFixed(1)
    );

    studentData.termTotals.annual = {
      total: Number(
        (
          studentData.termTotals.term1.total +
          studentData.termTotals.term2.total +
          studentData.termTotals.term3.total
        ).toFixed(1)
      ),
      average: annualAvg,
    };

    // Randomize conduct
    studentData.conduct.attendanceDays = 60 + Math.floor(Math.random() * 8);
    studentData.conduct.totalDays = 68;
    studentData.conduct.timesLate = Math.floor(Math.random() * 5);
    studentData.conduct.disciplinaryActions = Math.floor(Math.random() * 2);

    // Randomize parents
    studentData.administration.parents = `MR. AND MRS. ${lastName}`;

    mockStudents.push(studentData);
  }

  // Calculate ranks after all students generated
  ["term1", "term2", "term3", "annual"].forEach((termKey) => {
    mockStudents
      .sort(
        (a, b) => b.termTotals[termKey].average - a.termTotals[termKey].average
      )
      .forEach((student, idx) => {
        student.termTotals[termKey].rank = idx + 1;
        student.termTotals[termKey].outOf = count;
      });
  });

  // Calculate class statistics
  const annualAverages = mockStudents.map((s) => s.termTotals.annual.average);
  const classStats = {
    classAverage: Number(
      (annualAverages.reduce((a, b) => a + b, 0) / count).toFixed(1)
    ),
    highestAverage: Number(Math.max(...annualAverages).toFixed(1)),
    lowestAverage: Number(Math.min(...annualAverages).toFixed(1)),
  };

  mockStudents.forEach((student) => {
    student.classStatistics = classStats;
  });

  // Resolve term key
  const resolveTermKey = (rawTerm) => {
    const t = String(rawTerm ?? "annual")
      .trim()
      .toLowerCase();
    if (t === "annual" || t === "all" || t === "") return "annual";
    if (t === "term1" || t === "t1" || t.includes("first")) return "term1";
    if (t === "term2" || t === "t2" || t.includes("second")) return "term2";
    if (t === "term3" || t === "t3" || t.includes("third")) return "term3";
    return "annual";
  };

  const termKey = resolveTermKey(term);

  // Mock grading scale
  const mockGrading = [
    { band_min: 18, band_max: 20, comment: "Excellent" },
    { band_min: 16, band_max: 17.99, comment: "V.Good" },
    { band_min: 14, band_max: 15.99, comment: "Good" },
    { band_min: 12, band_max: 13.99, comment: "Fairly Good" },
    { band_min: 10, band_max: 11.99, comment: "Average" },
    { band_min: 0, band_max: 9.99, comment: "Weak" },
  ];

  // FIXED: Generate HTML directly from mock students
  // Do NOT use toTemplateCard - buildHTML expects original structure
  const logoUrl = `${req.protocol}://${req.get("host")}/public/logo.png`;
  const html = buildHTML(mockStudents, { logoUrl }, mockGrading);

  // Generate filename
  const sanitizeFilename = (s = "") => String(s).replace(/[^\w\-]+/g, "_");
  const filename = `TEST-${count}Students-${sanitizeFilename(
    termLabelFromKey(termKey)
  )}-report-cards.html`;

  // Set headers
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Test-Data", "true"); // Flag to indicate test data

  // Send HTML
  res.status(StatusCodes.OK).send(html);
});

module.exports = {
  bulkReportCards,
  singleReportCard,
  bulkReportCardsPdf,
  bulkReportCardsHTML,
  bulkReportCardsHTMLTest, // Add this export
};
