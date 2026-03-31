/* controllers/masterSheet.controller.js
 *
 * CLASS MASTER SHEET — Comprehensive academic analysis PDF.
 * Uses pdfmake (no HTML, no Puppeteer). Landscape A4.
 *
 * Sections:
 *   1. Cover & Executive Summary
 *   2. Marks Overview (ranked averages per subject)
 *   3. Detailed Sequence Scores (per category)
 *   4. Subject Performance Analysis
 *   5. Grade Distribution
 *   6. Top Performers & Attention Areas
 *   7. Signature Page
 *
 * Dependencies: pdfmake
 */

const PdfPrinter = require("pdfmake/src/Printer");
const path = require("path");
const fs = require("fs");
const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const models = require("../models/index.model");
const { buildReportCardsFromMarks } = require("./reportCard.controller");

/* ═══════════════════════════════════════════════════════════════════
   1. FONT & PRINTER SETUP
   ═══════════════════════════════════════════════════════════════════ */

const FONTS_DIR = path.resolve(__dirname, "../../fonts");
const printer = new PdfPrinter({
  Roboto: {
    normal: path.join(FONTS_DIR, "Roboto-Regular.ttf"),
    bold: path.join(FONTS_DIR, "Roboto-Medium.ttf"),
    italics: path.join(FONTS_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONTS_DIR, "Roboto-MediumItalic.ttf"),
  },
});

/* ═══════════════════════════════════════════════════════════════════
   2. DESIGN TOKENS
   ═══════════════════════════════════════════════════════════════════ */

const C = {
  primary: "#204080",
  primaryLight: "#3a5a9a",
  headerBg: "#e8eeff",
  cardBg: "#f8f9ff",
  altRow: "#f4f6ff",
  gold: "#c9a96e",
  dark: "#333333",
  light: "#666666",
  white: "#FFFFFF",
  red: "#cc0000",
  green: "#0d5f0d",
  orange: "#e67700",
  passGreen: "#d4edda",
  failRed: "#f8d7da",
  excellent: "#0d5f0d",
  vgood: "#1a5f1a",
  good: "#204080",
  fairlyGood: "#b8860b",
  average: "#ff8c00",
  weak: "#cc0000",
};

const noBorders = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

/* ═══════════════════════════════════════════════════════════════════
   3. GRADING
   ═══════════════════════════════════════════════════════════════════ */

const DEFAULT_GRADING = [
  { band_min: 18, band_max: 20, comment: "Excellent" },
  { band_min: 16, band_max: 17.99, comment: "V.Good" },
  { band_min: 14, band_max: 15.99, comment: "Good" },
  { band_min: 12, band_max: 13.99, comment: "Fairly Good" },
  { band_min: 10, band_max: 11.99, comment: "Average" },
  { band_min: 0, band_max: 9.99, comment: "Weak" },
];

function prepareGrading(custom) {
  const arr = Array.isArray(custom) && custom.length ? custom : DEFAULT_GRADING;
  return arr.slice().sort((a, b) => b.band_min - a.band_min);
}

function getRemark(avg, scale) {
  if (avg == null || isNaN(Number(avg))) return "N/A";
  const band = scale.find((g) => avg >= g.band_min && avg <= g.band_max);
  return band ? band.comment : "N/A";
}

function remarkColor(remark) {
  const n = String(remark || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  const map = {
    excellent: C.excellent,
    "v good": C.vgood,
    "very good": C.vgood,
    good: C.good,
    "fairly good": C.fairlyGood,
    average: C.average,
    weak: C.weak,
  };
  return map[n] || C.dark;
}

/* ═══════════════════════════════════════════════════════════════════
   4. FORMATTING HELPERS
   ═══════════════════════════════════════════════════════════════════ */

const round = (n, d = 1) => Number(Number(n).toFixed(d));
function fmtAvg(n) {
  return n == null || isNaN(Number(n)) ? "-" : Number(n).toFixed(1);
}
function fmtScore(n) {
  return n == null || isNaN(Number(n)) ? "-" : String(Math.round(Number(n)));
}
function fmtPct(n) {
  return n == null || isNaN(Number(n)) ? "-" : `${Number(n).toFixed(1)}%`;
}
function fmtRange(min, max) {
  const f = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
  return `${f(min)}-${f(max)}`;
}

function loadLogoBase64() {
  const logoPath = path.resolve(__dirname, "../../public/logo.png");
  if (!fs.existsSync(logoPath)) return null;
  return (
    "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64")
  );
}

function avgColor(v) {
  if (v == null || isNaN(Number(v))) return C.light;
  return Number(v) < 10 ? C.red : Number(v) >= 16 ? C.green : C.primary;
}

function pctColor(v) {
  if (v == null) return C.light;
  return v >= 80 ? C.green : v >= 50 ? C.orange : C.red;
}

function scoreCell(value, isAvg = false, sz = 7) {
  if (value == null || isNaN(Number(value)))
    return { text: "-", fontSize: sz, alignment: "center", color: C.light };
  const num = Number(value);
  return {
    text: isAvg ? num.toFixed(1) : String(Math.round(num)),
    fontSize: sz,
    alignment: "center",
    bold: isAvg,
    color: num < 10 ? C.red : isAvg ? C.primary : C.dark,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   5. TERM CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */

function getTermInfo(termKey) {
  const map = {
    term1: {
      avgKey: "term1Avg",
      seqKeys: ["seq1", "seq2"],
      seqHeaders: ["S1", "S2"],
      avgLabel: "T1 AVG",
      totalKey: "term1",
      label: "FIRST TERM",
      cumulativeLabel: "T1",
    },
    term2: {
      avgKey: "term2Avg",
      seqKeys: ["seq3", "seq4"],
      seqHeaders: ["S3", "S4"],
      avgLabel: "T2 AVG",
      totalKey: "term2",
      label: "SECOND TERM",
      cumulativeLabel: "T1 + T2",
    },
    term3: {
      avgKey: "term3Avg",
      seqKeys: ["seq5", "seq6"],
      seqHeaders: ["S5", "S6"],
      avgLabel: "T3 AVG",
      totalKey: "term3",
      label: "THIRD TERM",
      cumulativeLabel: "T1 + T2 + T3",
    },
    annual: {
      avgKey: "finalAvg",
      seqKeys: ["term1Avg", "term2Avg", "term3Avg"],
      seqHeaders: ["T1", "T2", "T3"],
      avgLabel: "FINAL",
      totalKey: "annual",
      label: "ANNUAL",
      cumulativeLabel: "ANNUAL",
    },
  };
  return map[termKey] || map.term3;
}

/* ═══════════════════════════════════════════════════════════════════
   6. DATA ANALYSIS ENGINE
   ═══════════════════════════════════════════════════════════════════ */

function analyzeMasterSheet(cards, termKey, gradingScale) {
  const ti = getTermInfo(termKey);

  /* ── Collect unique subjects (preserve order, general → prof → practical) ── */
  const genSubjects = [],
    profSubjects = [],
    pracSubjects = [];
  const seen = new Set();

  for (const card of cards) {
    const push = (arr, subjects, category) => {
      for (const s of subjects || []) {
        if (!seen.has(s.code)) {
          seen.add(s.code);
          arr.push({
            code: s.code,
            title: s.title,
            coef: s.coef,
            teacher: s.teacher,
            category,
          });
        }
      }
    };
    push(genSubjects, card.generalSubjects, "general");
    push(profSubjects, card.professionalSubjects, "professional");
    push(pracSubjects, card.practicalSubjects, "practical");
  }
  const allSubjects = [...genSubjects, ...profSubjects, ...pracSubjects];

  /* ── Build student rows ── */
  const students = cards
    .map((card) => {
      const tt = card.termTotals[ti.totalKey] || {};
      const allStudentSubjects = [
        ...(card.generalSubjects || []),
        ...(card.professionalSubjects || []),
        ...(card.practicalSubjects || []),
      ];

      const scores = {};
      for (const subj of allStudentSubjects) {
        scores[subj.code] = {
          ...subj.scores,
          average: subj.scores[ti.avgKey],
          coef: subj.coef,
        };
      }

      const catAvg = (subjectList) => {
        let tw = 0,
          tc = 0;
        for (const s of subjectList) {
          const sc = scores[s.code];
          if (sc && sc.average != null && !isNaN(Number(sc.average))) {
            tw += Number(sc.average) * s.coef;
            tc += s.coef;
          }
        }
        return tc > 0 ? round(tw / tc) : null;
      };

      return {
        id: card.student.id,
        name: card.student.name,
        regNo: card.student.registrationNumber,
        scores,
        genAvg: catAvg(genSubjects),
        profAvg: catAvg(profSubjects),
        pracAvg: catAvg(pracSubjects),
        total: tt.total,
        average: tt.average,
        rank: tt.rank,
        outOf: tt.outOf,
        term1Avg: card.termTotals.term1?.average,
        term2Avg: card.termTotals.term2?.average,
        term3Avg: card.termTotals.term3?.average,
        annualAvg: card.termTotals.annual?.average,
      };
    })
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));

  /* ── Per-subject statistics ── */
  const subjectStats = allSubjects.map((subj) => {
    const vals = [];
    const studentScores = [];
    for (const st of students) {
      const sc = st.scores[subj.code];
      if (sc && sc.average != null && !isNaN(Number(sc.average))) {
        vals.push(Number(sc.average));
        studentScores.push({ name: st.name, score: Number(sc.average) });
      }
    }
    if (!vals.length) {
      return {
        ...subj,
        classAvg: null,
        highest: null,
        highestStudent: "",
        lowest: null,
        lowestStudent: "",
        passed: 0,
        failed: 0,
        passRate: 0,
        failRate: 0,
        top3: [],
        bottom3: [],
        count: 0,
      };
    }
    const sorted = studentScores.sort((a, b) => b.score - a.score);
    const classAvg = round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const passed = vals.filter((v) => v >= 10).length;
    const failed = vals.filter((v) => v < 10).length;
    return {
      ...subj,
      classAvg,
      highest: sorted[0]?.score,
      highestStudent: sorted[0]?.name,
      lowest: sorted[sorted.length - 1]?.score,
      lowestStudent: sorted[sorted.length - 1]?.name,
      passed,
      failed,
      passRate: round((passed / vals.length) * 100),
      failRate: round((failed / vals.length) * 100),
      top3: sorted.slice(0, 3),
      bottom3: sorted.slice(-3).reverse(),
      count: vals.length,
    };
  });

  /* ── Overall statistics ── */
  const validAvgs = students
    .map((s) => s.average)
    .filter((a) => a != null && !isNaN(Number(a)) && Number(a) > 0);
  const passed = validAvgs.filter((a) => a >= 10).length;
  const failed = validAvgs.filter((a) => a < 10).length;
  const overallStats = {
    totalStudents: students.length,
    classAverage: validAvgs.length
      ? round(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length)
      : 0,
    highest: validAvgs.length ? round(Math.max(...validAvgs)) : 0,
    highestStudent: students[0]?.name || "",
    lowest: validAvgs.length ? round(Math.min(...validAvgs)) : 0,
    lowestStudent: students[students.length - 1]?.name || "",
    passed,
    failed,
    passRate: validAvgs.length ? round((passed / validAvgs.length) * 100) : 0,
    failRate: validAvgs.length ? round((failed / validAvgs.length) * 100) : 0,
    totalSubjects: allSubjects.length,
    genCount: genSubjects.length,
    profCount: profSubjects.length,
    pracCount: pracSubjects.length,
  };

  /* ── Grade distribution ── */
  const distribution = gradingScale.map((band) => {
    const row = {
      label: band.comment,
      band_min: band.band_min,
      band_max: band.band_max,
      overall: 0,
      perSubject: {},
    };
    for (const subj of allSubjects) row.perSubject[subj.code] = 0;

    for (const st of students) {
      if (
        st.average != null &&
        st.average >= band.band_min &&
        st.average <= band.band_max
      )
        row.overall++;
      for (const subj of allSubjects) {
        const sc = st.scores[subj.code];
        if (
          sc &&
          sc.average != null &&
          sc.average >= band.band_min &&
          sc.average <= band.band_max
        ) {
          row.perSubject[subj.code]++;
        }
      }
    }
    return row;
  });

  /* ── Failing students ── */
  const failingStudents = students
    .filter((s) => s.average != null && s.average < 10)
    .map((s) => {
      const weakSubjects = allSubjects
        .filter((subj) => {
          const sc = s.scores[subj.code];
          return sc && sc.average != null && sc.average < 10;
        })
        .map((subj) => ({
          code: subj.code,
          title: subj.title,
          score: s.scores[subj.code].average,
        }))
        .sort((a, b) => a.score - b.score);
      return { ...s, weakSubjects, totalFailed: weakSubjects.length };
    });

  /* ── High-failure subjects ── */
  const highFailureSubjects = subjectStats
    .filter((s) => s.failRate > 40)
    .sort((a, b) => b.failRate - a.failRate);

  /* ── Category statistics ── */
  const catStats = (list) => {
    const avgs = list.map((s) => s.classAvg).filter((v) => v != null);
    if (!avgs.length) return { avg: null, passed: 0, failed: 0, passRate: 0 };
    return {
      avg: round(avgs.reduce((a, b) => a + b, 0) / avgs.length),
      passed: list.reduce((s, x) => s + x.passed, 0),
      failed: list.reduce((s, x) => s + x.failed, 0),
      passRate: round(list.reduce((s, x) => s + x.passRate, 0) / list.length),
    };
  };

  return {
    genSubjects,
    profSubjects,
    pracSubjects,
    allSubjects,
    students,
    subjectStats,
    overallStats,
    distribution,
    failingStudents,
    highFailureSubjects,
    genStats: catStats(subjectStats.filter((s) => s.category === "general")),
    profStats: catStats(
      subjectStats.filter((s) => s.category === "professional")
    ),
    pracStats: catStats(subjectStats.filter((s) => s.category === "practical")),
    termInfo: ti,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   7. SHARED DATA-FETCHING LOGIC
   ═══════════════════════════════════════════════════════════════════ */

async function resolveTermKey(rawTerm, academicYearId) {
  const t = String(rawTerm ?? "term3")
    .trim()
    .toLowerCase();
  if (t === "term1" || t === "t1" || t.includes("first")) return "term1";
  if (t === "term2" || t === "t2" || t.includes("second")) return "term2";
  if (t === "term3" || t === "t3" || t.includes("third")) return "term3";
  if (t === "annual" || t === "all") return "annual";

  const n = Number(t);
  if (!Number.isNaN(n)) {
    if ([1, 2, 3].includes(n)) return `term${n}`;
    const row = await models.Term.findOne({
      where: { id: n, academic_year_id: academicYearId },
      attributes: ["order_number"],
    });
    if (row && [1, 2, 3].includes(Number(row.order_number)))
      return `term${row.order_number}`;
  }
  return "term3";
}

function termKeyToLabel(k) {
  return (
    {
      term1: "FIRST TERM",
      term2: "SECOND TERM",
      term3: "THIRD TERM",
      annual: "ANNUAL",
    }[k] || "THIRD TERM"
  );
}

async function fetchMarksWithIncludes(academicYearId, classId) {
  return models.marks.findAll({
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
}

/* ═══════════════════════════════════════════════════════════════════
   8. PDF SECTION BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

// ── Helper: section title bar ───────────────────────────────────

function sectionTitle(text, opts = {}) {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            text,
            fontSize: opts.fontSize || 11,
            bold: true,
            color: C.white,
            alignment: "center",
            fillColor: C.primary,
            margin: [0, 3, 0, 3],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: opts.margin || [0, 0, 0, 6],
  };
}

// ── Helper: stat card (label + value pair) ──────────────────────

function statCard(label, value, valueColor = C.primary) {
  return {
    stack: [
      {
        text: label,
        fontSize: 7,
        color: C.light,
        alignment: "center",
        margin: [0, 0, 0, 1],
      },
      {
        text: String(value ?? "-"),
        fontSize: 11,
        bold: true,
        color: valueColor,
        alignment: "center",
      },
    ],
    margin: [4, 2, 4, 2],
  };
}

// ── Helper: standard table layout ───────────────────────────────

function stdLayout(opts = {}) {
  return {
    hLineWidth: (i, node) => {
      if (i === 0 || i === node.table.body.length) return 1;
      if (i === 1) return 1; // header separator
      return 0.3;
    },
    vLineWidth: (i, node) =>
      i === 0 || i === node.table.widths.length ? 1 : 0.3,
    hLineColor: () => C.primary,
    vLineColor: () => C.primary,
    paddingLeft: () => opts.px || 3,
    paddingRight: () => opts.px || 3,
    paddingTop: () => opts.py || 1.5,
    paddingBottom: () => opts.py || 1.5,
    fillColor: (rowIndex) => {
      if (rowIndex === 0) return C.headerBg;
      if (opts.alternateRows && rowIndex % 2 === 0) return C.altRow;
      return null;
    },
  };
}

// ── Helper: header cell ─────────────────────────────────────────

function hdr(text, opts = {}) {
  return {
    text,
    fontSize: opts.fontSize || 6.5,
    bold: true,
    color: C.primary,
    alignment: opts.alignment || "center",
    fillColor: C.headerBg,
  };
}

// ── Helper: data cell ───────────────────────────────────────────

function cell(text, opts = {}) {
  return {
    text: String(text ?? "-"),
    fontSize: opts.fontSize || 7,
    bold: opts.bold || false,
    color: opts.color || C.dark,
    alignment: opts.alignment || "center",
    fillColor: opts.fillColor || null,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 1: COVER & EXECUTIVE SUMMARY
   ═══════════════════════════════════════════════════════════════════ */

function buildCoverPage(meta, analysis, gradingScale, logoBase64) {
  const { overallStats: os, termInfo: ti } = analysis;

  // ── Header with school branding ──
  const headerContent = [];

  if (logoBase64) {
    headerContent.push({
      image: logoBase64,
      width: 50,
      height: 50,
      alignment: "center",
      margin: [0, 0, 0, 4],
    });
  }

  headerContent.push(
    {
      text: "VOTECH S7 ACADEMY",
      fontSize: 16,
      bold: true,
      color: C.primary,
      alignment: "center",
      characterSpacing: 2,
      margin: [0, 0, 0, 2],
    },
    {
      text: "AZIRE - MANKON, BAMENDA",
      fontSize: 9,
      color: C.light,
      alignment: "center",
      margin: [0, 0, 0, 1],
    },
    {
      text: "Motto: Welfare, Productivity, Self Actualization",
      fontSize: 8,
      italics: true,
      color: C.gold,
      alignment: "center",
      margin: [0, 0, 0, 8],
    },
    {
      canvas: [
        {
          type: "line",
          x1: 200,
          y1: 0,
          x2: 600,
          y2: 0,
          lineWidth: 2,
          lineColor: C.primary,
        },
      ],
      margin: [0, 0, 0, 8],
    },
    {
      text: "CLASS MASTER SHEET",
      fontSize: 20,
      bold: true,
      color: C.primary,
      alignment: "center",
      characterSpacing: 3,
      margin: [0, 0, 0, 4],
    },
    {
      text: `${ti.label} — ${meta.academicYear}`,
      fontSize: 12,
      color: C.primaryLight,
      alignment: "center",
      margin: [0, 0, 0, 3],
    },
    {
      text: `${meta.className}  |  ${meta.departmentName}`,
      fontSize: 11,
      bold: true,
      color: C.dark,
      alignment: "center",
      margin: [0, 0, 0, 3],
    },
    {
      text: `Class Teacher: ${meta.classMaster || "N/A"}`,
      fontSize: 9,
      color: C.light,
      alignment: "center",
      margin: [0, 0, 0, 12],
    }
  );

  // ── Executive summary stats ──
  const summaryCards = {
    table: {
      widths: ["*", "*", "*", "*", "*", "*"],
      body: [
        [
          statCard("ENROLLED", os.totalStudents),
          statCard(
            "CLASS AVG",
            `${fmtAvg(os.classAverage)}/20`,
            avgColor(os.classAverage)
          ),
          statCard("HIGHEST", `${fmtAvg(os.highest)}`, C.green),
          statCard(
            "LOWEST",
            `${fmtAvg(os.lowest)}`,
            os.lowest < 10 ? C.red : C.dark
          ),
          statCard("PASSED", `${os.passed} (${fmtPct(os.passRate)})`, C.green),
          statCard(
            "FAILED",
            `${os.failed} (${fmtPct(os.failRate)})`,
            os.failed > 0 ? C.red : C.green
          ),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 0.5,
      hLineColor: () => C.primary,
      vLineColor: () => C.primary,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 4,
      paddingBottom: () => 4,
      fillColor: () => C.cardBg,
    },
    margin: [0, 0, 0, 10],
  };

  // ── Category breakdown ──
  const catRow = (label, stat, count) => [
    cell(label, { bold: true, alignment: "left", color: C.primary }),
    cell(String(count)),
    cell(stat.avg != null ? fmtAvg(stat.avg) : "-", {
      color: avgColor(stat.avg),
      bold: true,
    }),
    cell(fmtPct(stat.passRate), { color: pctColor(stat.passRate), bold: true }),
  ];

  const categoryTable = {
    table: {
      headerRows: 1,
      widths: [180, 60, 80, 80],
      body: [
        [
          hdr("CATEGORY", { alignment: "left" }),
          hdr("SUBJECTS"),
          hdr("AVG SCORE"),
          hdr("AVG PASS RATE"),
        ],
        catRow(
          "General Subjects",
          analysis.genStats,
          analysis.genSubjects.length
        ),
        catRow(
          "Professional Subjects",
          analysis.profStats,
          analysis.profSubjects.length
        ),
        catRow(
          "Practical Subjects",
          analysis.pracStats,
          analysis.pracSubjects.length
        ),
      ],
    },
    layout: stdLayout(),
    margin: [0, 0, 0, 10],
  };

  // ── Top 5 + Bottom 5 students side by side ──
  const top5 = analysis.students.slice(0, 5);
  const bottom5 = analysis.students.slice(-5).reverse();

  const rankTable = (title, list, color) => ({
    stack: [
      {
        text: title,
        fontSize: 8,
        bold: true,
        color,
        alignment: "center",
        margin: [0, 0, 0, 3],
      },
      {
        table: {
          headerRows: 1,
          widths: [20, "*", 40, 40],
          body: [
            [
              hdr("#"),
              hdr("STUDENT", { alignment: "left" }),
              hdr("AVG"),
              hdr("REMARK"),
            ],
            ...list.map((st) => {
              const rem = getRemark(st.average, gradingScale);
              return [
                cell(st.rank, { bold: true }),
                cell(st.name, { alignment: "left" }),
                cell(fmtAvg(st.average), {
                  color: avgColor(st.average),
                  bold: true,
                }),
                cell(rem, { color: remarkColor(rem), fontSize: 6 }),
              ];
            }),
          ],
        },
        layout: stdLayout({ alternateRows: true }),
      },
    ],
  });

  const topBottomRow = {
    columns: [
      { width: "*", ...rankTable("TOP 5 STUDENTS", top5, C.green) },
      { width: 20, text: "" },
      { width: "*", ...rankTable("BOTTOM 5 STUDENTS", bottom5, C.red) },
    ],
    margin: [0, 0, 0, 10],
  };

  // ── High-failure subject alerts ──
  const alerts = [];
  if (analysis.highFailureSubjects.length > 0) {
    alerts.push(
      {
        text: "⚠  SUBJECTS WITH HIGH FAILURE RATES (>40%)",
        fontSize: 9,
        bold: true,
        color: C.red,
        margin: [0, 0, 0, 4],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", 50, 50, 60, 60],
          body: [
            [
              hdr("SUBJECT", { alignment: "left" }),
              hdr("AVG"),
              hdr("FAIL %"),
              hdr("HIGHEST"),
              hdr("LOWEST"),
            ],
            ...analysis.highFailureSubjects.map((s) => [
              cell(`${s.code} - ${s.title}`, { alignment: "left" }),
              cell(fmtAvg(s.classAvg), {
                color: avgColor(s.classAvg),
                bold: true,
              }),
              cell(fmtPct(s.failRate), { color: C.red, bold: true }),
              cell(fmtAvg(s.highest), { color: C.green }),
              cell(fmtAvg(s.lowest), { color: C.red }),
            ]),
          ],
        },
        layout: stdLayout({ alternateRows: true }),
        margin: [0, 0, 0, 10],
      }
    );
  }

  return [
    ...headerContent,
    sectionTitle("EXECUTIVE SUMMARY"),
    summaryCards,
    categoryTable,
    topBottomRow,
    ...alerts,
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 2: MARKS OVERVIEW (Ranked table with averages per subject)
   ═══════════════════════════════════════════════════════════════════ */

function buildMarksOverview(analysis, gradingScale) {
  const { students, allSubjects, termInfo: ti } = analysis;

  // Adaptive font based on subject count
  const totalCols = allSubjects.length;
  const fs =
    totalCols > 20 ? 5.5 : totalCols > 15 ? 6 : totalCols > 10 ? 6.5 : 7;
  const hdrFs = fs - 0.5;
  const colW =
    totalCols > 20 ? 22 : totalCols > 15 ? 24 : totalCols > 10 ? 27 : 30;

  // Column widths: Rank, Name, ...subjects, GenAvg, ProfAvg, PracAvg, Overall, Remark
  const widths = [
    18, // Rank
    "*", // Name (flexible)
    ...allSubjects.map(() => colW),
    28,
    28,
    28, // Cat avgs
    30, // Overall
    40, // Remark
  ];

  // Header row
  const headerRow = [
    hdr("#", { fontSize: hdrFs }),
    hdr("STUDENT NAME", { fontSize: hdrFs, alignment: "left" }),
    ...allSubjects.map((s) => hdr(s.code, { fontSize: hdrFs })),
    hdr("GEN\nAVG", { fontSize: hdrFs }),
    hdr("PROF\nAVG", { fontSize: hdrFs }),
    hdr("PRAC\nAVG", { fontSize: hdrFs }),
    hdr(ti.avgLabel, { fontSize: hdrFs }),
    hdr("REMARK", { fontSize: hdrFs }),
  ];

  // Student rows
  const bodyRows = students.map((st, idx) => {
    const rem = getRemark(st.average, gradingScale);
    const rowFill = idx % 2 === 0 ? null : C.altRow;

    return [
      cell(st.rank, { fontSize: fs, bold: true, fillColor: rowFill }),
      cell(st.name, { fontSize: fs, alignment: "left", fillColor: rowFill }),
      ...allSubjects.map((subj) => {
        const sc = st.scores[subj.code];
        const avg = sc?.average;
        return {
          text: fmtAvg(avg),
          fontSize: fs,
          alignment: "center",
          bold: false,
          color: avg != null ? (Number(avg) < 10 ? C.red : C.dark) : C.light,
          fillColor: rowFill,
        };
      }),
      cell(fmtAvg(st.genAvg), {
        fontSize: fs,
        bold: true,
        color: avgColor(st.genAvg),
        fillColor: rowFill,
      }),
      cell(fmtAvg(st.profAvg), {
        fontSize: fs,
        bold: true,
        color: avgColor(st.profAvg),
        fillColor: rowFill,
      }),
      cell(fmtAvg(st.pracAvg), {
        fontSize: fs,
        bold: true,
        color: avgColor(st.pracAvg),
        fillColor: rowFill,
      }),
      cell(fmtAvg(st.average), {
        fontSize: fs + 0.5,
        bold: true,
        color: avgColor(st.average),
        fillColor: rowFill,
      }),
      cell(rem, {
        fontSize: fs - 0.5,
        bold: true,
        color: remarkColor(rem),
        fillColor: rowFill,
      }),
    ];
  });

  // Stats footer rows: Class Average, Highest, Lowest, Pass Rate
  const statFooter = (label, getter, formatter, colorFn) => [
    { text: "", fillColor: C.headerBg },
    {
      text: label,
      fontSize: fs,
      bold: true,
      color: C.primary,
      alignment: "left",
      fillColor: C.headerBg,
    },
    ...allSubjects.map((subj) => {
      const stat = analysis.subjectStats.find((s) => s.code === subj.code);
      const val = stat ? getter(stat) : null;
      return {
        text: formatter(val),
        fontSize: fs,
        bold: true,
        color: colorFn ? colorFn(val) : C.primary,
        alignment: "center",
        fillColor: C.headerBg,
      };
    }),
    { text: "", fillColor: C.headerBg, colSpan: 5 },
    ...Array(4).fill({ text: "", fillColor: C.headerBg }),
  ];

  const footerRows = [
    statFooter("CLASS AVG", (s) => s.classAvg, fmtAvg, avgColor),
    statFooter(
      "HIGHEST",
      (s) => s.highest,
      fmtAvg,
      () => C.green
    ),
    statFooter(
      "LOWEST",
      (s) => s.lowest,
      fmtAvg,
      (v) => (v != null && v < 10 ? C.red : C.dark)
    ),
    statFooter("PASS RATE", (s) => s.passRate, fmtPct, pctColor),
  ];

  return [
    sectionTitle(
      `SECTION 2: MARKS OVERVIEW — STUDENT AVERAGES BY SUBJECT (${ti.label})`
    ),
    {
      table: {
        headerRows: 1,
        widths,
        body: [headerRow, ...bodyRows, ...footerRows],
      },
      layout: {
        hLineWidth: (i, node) => {
          if (i === 0 || i === node.table.body.length) return 1;
          if (i === 1) return 1;
          if (i === node.table.body.length - 4) return 1.5; // before footer
          return 0.2;
        },
        vLineWidth: (i, node) =>
          i === 0 || i === node.table.widths.length || i === 2 ? 0.5 : 0.2,
        hLineColor: () => C.primary,
        vLineColor: () => C.primary,
        paddingLeft: () => 2,
        paddingRight: () => 2,
        paddingTop: () => 1,
        paddingBottom: () => 1,
        fillColor: (rowIndex) => (rowIndex === 0 ? C.headerBg : null),
      },
      margin: [0, 0, 0, 8],
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 3: DETAILED SEQUENCE SCORES (per category)
   ═══════════════════════════════════════════════════════════════════ */

function buildDetailedSequenceScores(analysis, gradingScale) {
  const { students, termInfo: ti } = analysis;
  const sections = [];

  const buildCategoryTable = (categoryLabel, subjects) => {
    if (!subjects.length) return [];

    const fs = subjects.length > 10 ? 6 : 6.5;
    const seqCount = ti.seqKeys.length;

    // For each subject: seqKeys... + avg
    // Total score columns per subject = seqCount + 1 (avg)
    const scoreColsPerSubj = seqCount + 1;
    const totalScoreCols = subjects.length * scoreColsPerSubj;
    const scoreW = totalScoreCols > 30 ? 18 : totalScoreCols > 20 ? 20 : 24;

    const widths = [
      18, // Rank
      "*", // Name
    ];
    subjects.forEach(() => {
      for (let i = 0; i < seqCount; i++) widths.push(scoreW);
      widths.push(scoreW + 2); // avg column slightly wider
    });
    widths.push(28); // category avg

    // Two-level header: subject codes on top, seq labels below
    const topHeaderRow = [
      { text: "", rowSpan: 2, fillColor: C.headerBg },
      {
        text: "STUDENT",
        rowSpan: 2,
        fontSize: fs,
        bold: true,
        color: C.primary,
        alignment: "left",
        fillColor: C.headerBg,
      },
    ];
    const bottomHeaderRow = [
      { text: "", fillColor: C.headerBg },
      { text: "", fillColor: C.headerBg },
    ];

    subjects.forEach((subj) => {
      topHeaderRow.push({
        text: subj.code,
        colSpan: scoreColsPerSubj,
        fontSize: fs,
        bold: true,
        color: C.primary,
        alignment: "center",
        fillColor: C.headerBg,
      });
      for (let i = 1; i < scoreColsPerSubj; i++)
        topHeaderRow.push({ text: "", fillColor: C.headerBg });

      ti.seqHeaders.forEach((sh) => {
        bottomHeaderRow.push({
          text: sh,
          fontSize: fs - 1,
          bold: true,
          color: C.primary,
          alignment: "center",
          fillColor: C.headerBg,
        });
      });
      bottomHeaderRow.push({
        text: "AVG",
        fontSize: fs - 1,
        bold: true,
        color: C.primary,
        alignment: "center",
        fillColor: C.headerBg,
      });
    });

    topHeaderRow.push({
      text: "CAT\nAVG",
      rowSpan: 2,
      fontSize: fs,
      bold: true,
      color: C.primary,
      alignment: "center",
      fillColor: C.headerBg,
    });
    bottomHeaderRow.push({ text: "", fillColor: C.headerBg });

    // Data rows
    const bodyRows = students.map((st, idx) => {
      const rowFill = idx % 2 === 0 ? null : C.altRow;
      const row = [
        cell(st.rank, { fontSize: fs, bold: true, fillColor: rowFill }),
        cell(st.name, { fontSize: fs, alignment: "left", fillColor: rowFill }),
      ];

      subjects.forEach((subj) => {
        const sc = st.scores[subj.code] || {};
        ti.seqKeys.forEach((seqKey) => {
          const val = sc[seqKey];
          row.push({
            text:
              val != null && !isNaN(Number(val))
                ? ti.totalKey === "annual"
                  ? fmtAvg(val)
                  : fmtScore(val)
                : "-",
            fontSize: fs,
            alignment: "center",
            color: val != null && Number(val) < 10 ? C.red : C.dark,
            fillColor: rowFill,
          });
        });
        const avg = sc.average;
        row.push({
          text: fmtAvg(avg),
          fontSize: fs,
          bold: true,
          alignment: "center",
          color: avgColor(avg),
          fillColor: rowFill,
        });
      });

      // Category average
      const catKey = categoryLabel.toLowerCase().includes("general")
        ? "genAvg"
        : categoryLabel.toLowerCase().includes("professional")
        ? "profAvg"
        : "pracAvg";
      row.push(
        cell(fmtAvg(st[catKey]), {
          fontSize: fs,
          bold: true,
          color: avgColor(st[catKey]),
          fillColor: rowFill,
        })
      );

      return row;
    });

    return [
      sectionTitle(`${categoryLabel} — DETAILED SCORES`, { fontSize: 9 }),
      {
        table: {
          headerRows: 2,
          widths,
          body: [topHeaderRow, bottomHeaderRow, ...bodyRows],
        },
        layout: {
          hLineWidth: (i, node) => {
            if (i === 0 || i === node.table.body.length) return 1;
            if (i <= 2) return 0.8;
            return 0.15;
          },
          vLineWidth: (i, node) => {
            if (i === 0 || i === node.table.widths.length || i === 2)
              return 0.5;
            return 0.15;
          },
          hLineColor: () => C.primary,
          vLineColor: () => C.primary,
          paddingLeft: () => 1.5,
          paddingRight: () => 1.5,
          paddingTop: () => 1,
          paddingBottom: () => 1,
        },
        margin: [0, 0, 0, 8],
      },
    ];
  };

  sections.push(
    ...buildCategoryTable("GENERAL SUBJECTS", analysis.genSubjects)
  );
  sections.push(
    ...buildCategoryTable("PROFESSIONAL SUBJECTS", analysis.profSubjects)
  );
  sections.push(
    ...buildCategoryTable("PRACTICAL SUBJECTS", analysis.pracSubjects)
  );

  return [
    sectionTitle(
      `SECTION 3: DETAILED SEQUENCE SCORES (${analysis.termInfo.label})`
    ),
    ...sections,
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 4: SUBJECT PERFORMANCE ANALYSIS
   ═══════════════════════════════════════════════════════════════════ */

function buildSubjectPerformance(analysis, gradingScale) {
  const { subjectStats } = analysis;

  const widths = [30, "*", 28, 35, 35, 35, 35, 35, 35, "*", "*"];
  const headerRow = [
    hdr("CODE"),
    hdr("SUBJECT", { alignment: "left" }),
    hdr("COEF"),
    hdr("CLASS\nAVG"),
    hdr("HIGHEST"),
    hdr("LOWEST"),
    hdr("PASSED"),
    hdr("FAILED"),
    hdr("PASS\nRATE"),
    hdr("BEST STUDENT", { alignment: "left" }),
    hdr("TEACHER", { alignment: "left" }),
  ];

  const bodyRows = subjectStats.map((s, idx) => {
    const rem = getRemark(s.classAvg, gradingScale);
    const rowFill = idx % 2 === 0 ? null : C.altRow;

    return [
      cell(s.code, { bold: true, color: C.primary, fillColor: rowFill }),
      cell(s.title, { alignment: "left", fillColor: rowFill }),
      cell(s.coef, { fillColor: rowFill }),
      cell(fmtAvg(s.classAvg), {
        bold: true,
        color: avgColor(s.classAvg),
        fillColor: rowFill,
      }),
      cell(fmtAvg(s.highest), { color: C.green, fillColor: rowFill }),
      cell(fmtAvg(s.lowest), {
        color: s.lowest != null && s.lowest < 10 ? C.red : C.dark,
        fillColor: rowFill,
      }),
      cell(s.passed, { color: C.green, fillColor: rowFill }),
      cell(s.failed, {
        color: s.failed > 0 ? C.red : C.green,
        fillColor: rowFill,
      }),
      cell(fmtPct(s.passRate), {
        bold: true,
        color: pctColor(s.passRate),
        fillColor: rowFill,
      }),
      cell(s.highestStudent || "-", {
        alignment: "left",
        fontSize: 6,
        fillColor: rowFill,
      }),
      cell(s.teacher || "-", {
        alignment: "left",
        fontSize: 6,
        color: C.light,
        fillColor: rowFill,
      }),
    ];
  });

  return [
    sectionTitle("SECTION 4: SUBJECT PERFORMANCE ANALYSIS"),
    {
      table: { headerRows: 1, widths, body: [headerRow, ...bodyRows] },
      layout: stdLayout({ alternateRows: false }),
      margin: [0, 0, 0, 8],
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 5: GRADE DISTRIBUTION
   ═══════════════════════════════════════════════════════════════════ */

function buildGradeDistribution(analysis, gradingScale) {
  const { distribution, allSubjects, overallStats: os } = analysis;
  const totalStudents = os.totalStudents;

  // Overall distribution table
  const overallWidths = [80, 60, 50, "*"];
  const overallBody = [
    [
      hdr("GRADE", { alignment: "left" }),
      hdr("RANGE"),
      hdr("COUNT"),
      hdr("PERCENTAGE"),
    ],
    ...distribution.map((d) => {
      const pct =
        totalStudents > 0 ? round((d.overall / totalStudents) * 100) : 0;
      return [
        cell(d.label, {
          alignment: "left",
          bold: true,
          color: remarkColor(d.label),
        }),
        cell(fmtRange(d.band_min, d.band_max)),
        cell(d.overall, { bold: true }),
        cell(fmtPct(pct), { bold: true, color: pctColor(pct) }),
      ];
    }),
  ];

  // Per-subject distribution (compact — subjects as columns)
  const fs = allSubjects.length > 15 ? 5.5 : allSubjects.length > 10 ? 6 : 6.5;
  const subjColW =
    allSubjects.length > 15 ? 22 : allSubjects.length > 10 ? 26 : 30;
  const perSubjWidths = [70, ...allSubjects.map(() => subjColW)];

  const perSubjHeader = [
    hdr("GRADE", { alignment: "left", fontSize: fs }),
    ...allSubjects.map((s) => hdr(s.code, { fontSize: fs })),
  ];

  const perSubjRows = distribution.map((d) => [
    cell(d.label, {
      alignment: "left",
      bold: true,
      color: remarkColor(d.label),
      fontSize: fs,
    }),
    ...allSubjects.map((subj) => {
      const count = d.perSubject[subj.code] || 0;
      return cell(count > 0 ? count : "-", {
        fontSize: fs,
        color: count > 0 ? C.dark : C.light,
      });
    }),
  ]);

  return [
    sectionTitle("SECTION 5: GRADE DISTRIBUTION"),
    {
      columns: [
        {
          width: 280,
          stack: [
            {
              text: "OVERALL DISTRIBUTION",
              fontSize: 8,
              bold: true,
              color: C.primary,
              margin: [0, 0, 0, 3],
            },
            {
              table: {
                headerRows: 1,
                widths: overallWidths,
                body: overallBody,
              },
              layout: stdLayout(),
            },
          ],
        },
        { width: 20, text: "" },
        {
          width: "*",
          stack: [
            {
              text: "DISTRIBUTION PER SUBJECT (student count per grade band)",
              fontSize: 8,
              bold: true,
              color: C.primary,
              margin: [0, 0, 0, 3],
            },
            {
              table: {
                headerRows: 1,
                widths: perSubjWidths,
                body: [perSubjHeader, ...perSubjRows],
              },
              layout: stdLayout(),
            },
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 6: TOP PERFORMERS & ATTENTION AREAS
   ═══════════════════════════════════════════════════════════════════ */

function buildTopPerformersAndAtRisk(analysis, gradingScale) {
  const sections = [];

  // ── Subject champions: best student in each subject ──
  const champRows = analysis.subjectStats
    .filter((s) => s.highest != null)
    .map((s) => [
      cell(s.code, { bold: true, color: C.primary }),
      cell(s.title, { alignment: "left" }),
      cell(s.highestStudent, { alignment: "left", bold: true }),
      cell(fmtAvg(s.highest), { bold: true, color: C.green }),
    ]);

  if (champRows.length) {
    sections.push(
      {
        text: "SUBJECT CHAMPIONS — BEST STUDENT PER SUBJECT",
        fontSize: 9,
        bold: true,
        color: C.green,
        margin: [0, 0, 0, 4],
      },
      {
        table: {
          headerRows: 1,
          widths: [30, "*", "*", 40],
          body: [
            [
              hdr("CODE"),
              hdr("SUBJECT", { alignment: "left" }),
              hdr("STUDENT", { alignment: "left" }),
              hdr("SCORE"),
            ],
            ...champRows,
          ],
        },
        layout: stdLayout({ alternateRows: true }),
        margin: [0, 0, 0, 10],
      }
    );
  }

  // ── At-risk students (failing) ──
  const { failingStudents } = analysis;
  if (failingStudents.length) {
    sections.push({
      text: `⚠  AT-RISK STUDENTS — AVERAGE BELOW 10/20 (${
        failingStudents.length
      } student${failingStudents.length > 1 ? "s" : ""})`,
      fontSize: 9,
      bold: true,
      color: C.red,
      margin: [0, 4, 0, 4],
    });

    const atRiskRows = failingStudents.map((st) => {
      const weakList = st.weakSubjects
        .slice(0, 5)
        .map((w) => `${w.code} (${fmtAvg(w.score)})`)
        .join(", ");
      return [
        cell(st.rank),
        cell(st.name, { alignment: "left", bold: true }),
        cell(fmtAvg(st.average), { bold: true, color: C.red }),
        cell(st.totalFailed, { color: C.red, bold: true }),
        cell(weakList, { alignment: "left", fontSize: 6, color: C.red }),
      ];
    });

    sections.push({
      table: {
        headerRows: 1,
        widths: [20, "*", 35, 40, "*"],
        body: [
          [
            hdr("#"),
            hdr("STUDENT", { alignment: "left" }),
            hdr("AVG"),
            hdr("FAILED\nSUBJ."),
            hdr("WEAKEST SUBJECTS", { alignment: "left" }),
          ],
          ...atRiskRows,
        ],
      },
      layout: stdLayout({ alternateRows: true }),
      margin: [0, 0, 0, 10],
    });
  } else {
    sections.push({
      text: "✓  No at-risk students — all students have an average of 10/20 or above.",
      fontSize: 9,
      bold: true,
      color: C.green,
      margin: [0, 4, 0, 10],
    });
  }

  // ── Subjects needing attention (>40% failure) ──
  const { highFailureSubjects } = analysis;
  if (highFailureSubjects.length) {
    sections.push(
      {
        text: "⚠  SUBJECTS NEEDING ATTENTION — FAILURE RATE ABOVE 40%",
        fontSize: 9,
        bold: true,
        color: C.red,
        margin: [0, 4, 0, 4],
      },
      {
        table: {
          headerRows: 1,
          widths: [30, "*", 40, 40, 50, 50, "*"],
          body: [
            [
              hdr("CODE"),
              hdr("SUBJECT", { alignment: "left" }),
              hdr("AVG"),
              hdr("FAIL %"),
              hdr("LOWEST STUDENT", { alignment: "left" }),
              hdr("LOWEST SCORE"),
              hdr("TEACHER", { alignment: "left" }),
            ],
            ...highFailureSubjects.map((s) => [
              cell(s.code, { bold: true, color: C.primary }),
              cell(s.title, { alignment: "left" }),
              cell(fmtAvg(s.classAvg), {
                color: avgColor(s.classAvg),
                bold: true,
              }),
              cell(fmtPct(s.failRate), { color: C.red, bold: true }),
              cell(s.lowestStudent, { alignment: "left", fontSize: 6 }),
              cell(fmtAvg(s.lowest), { color: C.red }),
              cell(s.teacher || "-", {
                alignment: "left",
                fontSize: 6,
                color: C.light,
              }),
            ]),
          ],
        },
        layout: stdLayout({ alternateRows: true }),
        margin: [0, 0, 0, 10],
      }
    );
  }

  return [
    sectionTitle("SECTION 6: TOP PERFORMERS & ATTENTION AREAS"),
    ...sections,
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 7: SIGNATURE PAGE
   ═══════════════════════════════════════════════════════════════════ */

function buildSignaturePage(meta) {
  const sigBlock = (title, name) => ({
    stack: [
      {
        text: title,
        fontSize: 8,
        bold: true,
        color: C.primary,
        alignment: "center",
        margin: [0, 0, 0, 30],
      },
      {
        canvas: [
          {
            type: "line",
            x1: 20,
            y1: 0,
            x2: 200,
            y2: 0,
            lineWidth: 0.8,
            lineColor: C.primary,
          },
        ],
        margin: [0, 0, 0, 3],
      },
      {
        text: (name || "").toUpperCase(),
        fontSize: 7,
        bold: true,
        color: C.dark,
        alignment: "center",
        margin: [0, 0, 0, 2],
      },
      {
        text: "Date & Signature",
        fontSize: 6,
        italics: true,
        color: C.light,
        alignment: "center",
      },
    ],
  });

  return [
    sectionTitle("SIGNATURES & APPROVAL"),
    { text: "", margin: [0, 10, 0, 0] },
    {
      columns: [
        { width: "*", ...sigBlock("CLASS TEACHER", meta.classMaster) },
        { width: "*", ...sigBlock("PRINCIPAL", meta.principal || "") },
      ],
      columnGap: 60,
      margin: [40, 0, 40, 20],
    },
    { text: "", margin: [0, 10, 0, 0] },
    {
      text: `© ${new Date().getFullYear()} Izzy Tech Team – Official Document | Votech (S7) Academy`,
      fontSize: 6,
      italics: true,
      color: C.light,
      alignment: "center",
      margin: [0, 20, 0, 0],
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   9. ASSEMBLE FULL DOCUMENT
   ═══════════════════════════════════════════════════════════════════ */

function buildMasterSheetDoc(meta, analysis, gradingScale, logoBase64) {
  const content = [];

  // Section 1: Cover & Executive Summary
  content.push(...buildCoverPage(meta, analysis, gradingScale, logoBase64));

  // Section 2: Marks Overview (page break)
  content.push({ text: "", pageBreak: "before" });
  content.push(...buildMarksOverview(analysis, gradingScale));

  // Section 3: Detailed Sequence Scores (page break)
  content.push({ text: "", pageBreak: "before" });
  content.push(...buildDetailedSequenceScores(analysis, gradingScale));

  // Section 4: Subject Performance Analysis (page break)
  content.push({ text: "", pageBreak: "before" });
  content.push(...buildSubjectPerformance(analysis, gradingScale));

  // Section 5: Grade Distribution
  content.push({ text: "", pageBreak: "before" });
  content.push(...buildGradeDistribution(analysis, gradingScale));

  // Section 6: Top Performers & At-Risk
  content.push({ text: "", pageBreak: "before" });
  content.push(...buildTopPerformersAndAtRisk(analysis, gradingScale));

  // Section 7: Signature Page
  content.push({ text: "", pageBreak: "before" });
  content.push(...buildSignaturePage(meta));

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [20, 20, 20, 30],
    content,
    defaultStyle: {
      font: "Roboto",
      fontSize: 7,
      lineHeight: 1.1,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: `${meta.className} — ${analysis.termInfo.label} — ${meta.academicYear}`,
          fontSize: 6,
          color: C.light,
          margin: [20, 0, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 6,
          color: C.light,
          alignment: "right",
          margin: [0, 0, 20, 0],
        },
      ],
    }),
    ...(logoBase64
      ? {
          background: (_currentPage, pageSize) => ({
            image: logoBase64,
            width: 300,
            height: 300,
            opacity: 0.03,
            absolutePosition: {
              x: (pageSize.width - 300) / 2,
              y: (pageSize.height - 300) / 2,
            },
          }),
        }
      : {}),
    info: {
      title: `Master Sheet — ${meta.className} — ${analysis.termInfo.label}`,
      author: "Izzy Tech Team",
      subject: `Class Master Sheet — ${meta.academicYear}`,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   10. PDF BUFFER GENERATOR
   ═══════════════════════════════════════════════════════════════════ */

function generatePdfBuffer(docDefinition) {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   11. CONTROLLER ENDPOINTS
   ═══════════════════════════════════════════════════════════════════ */

const sanitize = (s = "") => String(s).replace(/[^\w\-]+/g, "_");

// ── CLASS MASTER SHEET PDF ──────────────────────────────────────

const classMasterSheet = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId, term = "term3" } = req.query;

  if (!academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const [academicYear, department, studentClass] = await Promise.all([
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

  if (!academicYear)
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  if (!department)
    return next(new AppError("Department not found", StatusCodes.NOT_FOUND));
  if (!studentClass)
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));

  const marks = await fetchMarksWithIncludes(academicYearId, classId);
  if (!marks.length) {
    return next(
      new AppError(
        `No marks found for ${studentClass.name} in ${department.name} (${academicYear.name}).`,
        StatusCodes.NOT_FOUND
      )
    );
  }

  const classMaster =
    studentClass?.classMaster?.name ||
    studentClass?.classMaster?.username ||
    "";

  const termKey = await resolveTermKey(term, academicYearId);

  const cards = buildReportCardsFromMarks(marks, classMaster, termKey);

  // Fetch custom grading
  const gradingRaw = await models.academic_bands.findAll({
    where: { academic_year_id: academicYear.id, class_id: studentClass.id },
    raw: true,
  });
  const gradingScale = prepareGrading(gradingRaw);

  // Analyze data
  const analysis = analyzeMasterSheet(cards, termKey, gradingScale);

  // Build metadata
  const meta = {
    schoolName: "VOTECH S7 ACADEMY",
    className: studentClass.name,
    departmentName: department.name,
    academicYear: academicYear.name,
    classMaster,
    principal: req.query.principal || "Dr. ACADEMIC DIRECTOR",
  };

  // Build PDF
  const logoBase64 = loadLogoBase64();
  const docDef = buildMasterSheetDoc(meta, analysis, gradingScale, logoBase64);
  const pdfBuffer = await generatePdfBuffer(docDef);

  // Stream response
  const filename = `MasterSheet-${sanitize(academicYear.name)}-${sanitize(
    department.name
  )}-${sanitize(studentClass.name)}-${sanitize(analysis.termInfo.label)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.status(200).end(pdfBuffer);
});

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  classMasterSheet,
  // Export internals for testing if needed
  analyzeMasterSheet,
  buildMasterSheetDoc,
};
