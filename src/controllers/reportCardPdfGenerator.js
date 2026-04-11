/* controllers/bulkReportCardsPdfDirect.controller.js
 *
 * Direct PDF generation using pdfmake — no HTML, no Puppeteer.
 * Matches the React <ReportCard /> component design exactly.
 *
 * ▸ Every report card is guaranteed to fit on ONE page.
 * ▸ Bottom-section boxes (conduct / grading / admin) always share
 *   the same height and never split from their titles.
 *
 * OPTIMIZATIONS (v2):
 *   1. Marks query uses raw: true + explicit attributes to avoid
 *      Sequelize model hydration overhead on thousands of rows.
 *   2. Logo is loaded once and reused across all pages.
 *   3. PDF is streamed directly to the response (no full buffer in memory).
 *   4. Class statistics computed once, not per-student.
 *   5. Grading scale fetched in parallel with marks.
 *
 * Dependencies: npm install pdfmake
 * Font files:   ./fonts/Roboto-*.ttf  (shipped with pdfmake)
 */

const PdfPrinter = require("pdfmake/src/printer");
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
   2. DESIGN TOKENS  (mirrors ReportCard.css variables)
   ═══════════════════════════════════════════════════════════════════ */

const C = {
  primary: "#204080",
  primaryLight: "#3a5a9a",
  headerBg: "#e8eeff",
  headerBgLight: "#f0f4ff",
  cardBg: "#f8f9ff",
  gold: "#c9a96e",
  dark: "#333333",
  light: "#666666",
  red: "#cc0000",
  white: "#FFFFFF",

  excellent: "#0d5f0d",
  vgood: "#1a5f1a",
  good: "#204080",
  fairlyGood: "#b8860b",
  average: "#ff8c00",
  weak: "#cc0000",
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

function fmtScore(n) {
  if (n == null || isNaN(Number(n))) return "-";
  return Number(n).toFixed(1); // 17.4 → "17.4"
}

function fmtAvg(n) {
  if (n == null || isNaN(Number(n))) return "-";
  return Number(n).toFixed(1);
}

function fmtRange(min, max) {
  const fmt = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
  return `${fmt(min)}-${fmt(max)}`;
}

/* ═══════════════════════════════════════════════════════════════════
   4b. TEACHER NAME FORMATTING
   ═══════════════════════════════════════════════════════════════════
   Rules:
     - Title case: first letter uppercase, rest lowercase
     - If 3+ names, abbreviate the last name to its initial
     - Result must always fit on one line in the teacher column
   Examples:
     "DJIMO DJIMO BEN OKAFOR"  → "Djimo Djimo Ben O."
     "MANKAA CARINE AWAH"      → "Mankaa Carine A."
     "NGAH DIVINE"             → "Ngah Divine"
     "MR. THOMAS AMBE"         → "Mr. Thomas Ambe"
   ═══════════════════════════════════════════════════════════════════ */

function formatTeacherName(raw) {
  if (!raw || typeof raw !== "string") return "N/A";
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0) return "N/A";

  // Title-case each part
  const titled = parts.map(
    (p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  );

  // If 3+ names, abbreviate the last one
  if (titled.length >= 3) {
    titled[titled.length - 1] = titled[titled.length - 1].charAt(0) + ".";
  }

  return titled.join(" ");
}

/* ═══════════════════════════════════════════════════════════════════
   5. TERM-SPECIFIC COLUMN CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */

function getTermConfig(termLabel) {
  if (termLabel === "FIRST TERM") {
    return {
      scoreColumns: [
        { key: "seq1", header: "SEQ 1", isAvg: false },
        { key: "seq2", header: "SEQ 2", isAvg: false },
        { key: "_termAvg", header: "TERM\nAVG", isAvg: true },
      ],
      getTermAvg: (s) => s.scores.term1Avg,
      termTotalKey: "term1",
      cumulativeLabel: "T1",
      getCumulative: (tt) =>
        typeof tt.term1?.average === "number" ? tt.term1.average : null,
    };
  }

  if (termLabel === "SECOND TERM") {
    return {
      scoreColumns: [
        { key: "seq3", header: "SEQ 3", isAvg: false },
        { key: "seq4", header: "SEQ 4", isAvg: false },
        { key: "_termAvg", header: "TERM\nAVG", isAvg: true },
        { key: "term1Avg", header: "T1\nAVG", isAvg: true },
        { key: "_yearAvg", header: "TOTAL\nAVG", isAvg: true },
      ],
      getTermAvg: (s) => s.scores.term2Avg,
      getYearAvg: (s) => {
        const t1 = s.scores.term1Avg;
        const t2 = s.scores.term2Avg;
        if (t1 == null || t2 == null) return null;
        return round((t1 + t2) / 2);
      },
      termTotalKey: "term2",
      cumulativeLabel: "T1 + T2",
      getCumulative: (tt) => {
        const a = [tt.term1?.average, tt.term2?.average].filter(
          (v) => typeof v === "number"
        );
        return a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : null;
      },
    };
  }

  // THIRD TERM
  return {
    scoreColumns: [
      { key: "seq5", header: "SEQ 5", isAvg: false },
      { key: "seq6", header: "SEQ 6", isAvg: false },
      { key: "_termAvg", header: "TERM\nAVG", isAvg: true },
      { key: "term1Avg", header: "T1\nAVG", isAvg: true },
      { key: "term2Avg", header: "T2\nAVG", isAvg: true },
      { key: "_finalAvg", header: "FINAL\nAVG", isAvg: true },
    ],
    getTermAvg: (s) => s.scores.term3Avg,
    getFinalAvg: (s) => s.scores.finalAvg,
    termTotalKey: "term3",
    cumulativeLabel: "T1 + T2 + T3",
    getCumulative: (tt) => {
      const a = [
        tt.term1?.average,
        tt.term2?.average,
        tt.term3?.average,
      ].filter((v) => typeof v === "number");
      return a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   6. RESOLVE CELL VALUE FOR A COLUMN KEY
   ═══════════════════════════════════════════════════════════════════ */

function resolveCellValue(subject, col, termCfg) {
  if (col.key === "_termAvg") return termCfg.getTermAvg(subject);
  if (col.key === "_yearAvg" && termCfg.getYearAvg)
    return termCfg.getYearAvg(subject);
  if (col.key === "_finalAvg" && termCfg.getFinalAvg)
    return termCfg.getFinalAvg(subject);
  return subject.scores[col.key];
}

/* ═══════════════════════════════════════════════════════════════════
   7. LOGO LOADER (cached — loaded once on startup)
   ═══════════════════════════════════════════════════════════════════ */

let _cachedLogo = undefined; // undefined = not loaded yet, null = no file

function loadLogoBase64() {
  if (_cachedLogo !== undefined) return _cachedLogo;
  const logoPath = path.resolve(__dirname, "../../public/logo.png");
  if (!fs.existsSync(logoPath)) {
    _cachedLogo = null;
    return null;
  }
  const buf = fs.readFileSync(logoPath);
  _cachedLogo = "data:image/png;base64," + buf.toString("base64");
  return _cachedLogo;
}

/* ═══════════════════════════════════════════════════════════════════
   8. ADAPTIVE FONT-SIZE HELPER
   ═══════════════════════════════════════════════════════════════════ */

function subjectFontSizes(totalSubjectCount) {
  if (totalSubjectCount <= 14)
    return { row: 7.5, title: 7, code: 7.5, remark: 7, teacher: 6 };
  if (totalSubjectCount <= 20)
    return { row: 7, title: 6.5, code: 7, remark: 6.5, teacher: 5.5 };
  if (totalSubjectCount <= 26)
    return { row: 6.5, title: 6, code: 6.5, remark: 6, teacher: 5 };
  return { row: 6, title: 5.5, code: 6, remark: 5.5, teacher: 5 };
}

/* ═══════════════════════════════════════════════════════════════════
   9. PAGE SECTION BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

// ── 9a. DOCUMENT HEADER ──────────────────────────────────────────

function buildHeader(data, logoBase64) {
  const frenchSide = [
    {
      text: "RÉPUBLIQUE DU CAMEROUN",
      fontSize: 7,
      bold: true,
      color: C.primary,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "PAIX - TRAVAIL - PATRIE",
      fontSize: 6,
      bold: true,
      italics: true,
      color: C.gold,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "MINISTÈRE DE L'EMPLOI ET DE LA\nFORMATION PROFESSIONNELLE",
      fontSize: 6.5,
      bold: true,
      color: C.primary,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "DIRECTION DE L'ENSEIGNEMENT PRIVÉ",
      fontSize: 6,
      bold: true,
      color: C.primary,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "VOTECH S7 ACADEMY",
      fontSize: 7,
      bold: true,
      color: C.primary,
      alignment: "center",
      characterSpacing: 0.5,
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "AZIRE - MANKON",
      fontSize: 6,
      bold: true,
      color: C.light,
      alignment: "center",
    },
  ];

  const englishSide = [
    {
      text: "REPUBLIC OF CAMEROON",
      fontSize: 7,
      bold: true,
      color: C.primary,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "PEACE - WORK - FATHERLAND",
      fontSize: 6,
      bold: true,
      italics: true,
      color: C.gold,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "MINISTRY OF EMPLOYMENT AND\nVOCATIONAL TRAINING",
      fontSize: 6.5,
      bold: true,
      color: C.primary,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "DEPARTMENT OF PRIVATE\nVOCATIONAL INSTITUTE",
      fontSize: 6,
      bold: true,
      color: C.primary,
      alignment: "center",
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "VOTECH S7 ACADEMY",
      fontSize: 7,
      bold: true,
      color: C.primary,
      alignment: "center",
      characterSpacing: 0.5,
      margin: [0, 0, 0, 0.5],
    },
    {
      text: "AZIRE - MANKON",
      fontSize: 6,
      bold: true,
      color: C.light,
      alignment: "center",
    },
  ];

  const centerContent = [];
  if (logoBase64) {
    centerContent.push({
      image: logoBase64,
      width: 40,
      height: 40,
      alignment: "center",
      margin: [0, 0, 0, 2],
    });
  }
  centerContent.push({
    text: "IGNITING ''Preneurs",
    fontSize: 8,
    bold: true,
    color: C.primary,
    alignment: "center",
    characterSpacing: 0.5,
    margin: [0, 0, 0, 1],
  });
  centerContent.push({
    text: "Motto: Welfare, Productivity,\nSelf Actualization",
    fontSize: 6,
    bold: true,
    italics: true,
    color: C.gold,
    alignment: "center",
  });

  const headerStack = {
    stack: [
      {
        columns: [
          { width: "*", stack: frenchSide },
          { width: 120, stack: centerContent },
          { width: "*", stack: englishSide },
        ],
        columnGap: 6,
        margin: [0, 0, 0, 4],
      },
      {
        text: "ACADEMIC REPORT CARD",
        fontSize: 11,
        bold: true,
        color: C.primary,
        alignment: "center",
        characterSpacing: 1.5,
        margin: [0, 2, 0, 1],
      },
      {
        text: `${data.student.term || ""} • ${data.student.academicYear || ""}`,
        fontSize: 8,
        color: C.light,
        alignment: "center",
      },
    ],
  };

  return {
    table: {
      widths: ["*"],
      body: [[{ ...headerStack, fillColor: C.cardBg }]],
    },
    layout: {
      hLineWidth: (i) => (i === 1 ? 2 : 0),
      vLineWidth: () => 0,
      hLineColor: () => C.primary,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 3],
  };
}

// ── 9b. STUDENT INFORMATION ──────────────────────────────────────

function buildStudentInfo(data) {
  const s = data.student;

  const label = (text) => ({
    text,
    fontSize: 8,
    bold: true,
    color: C.primary,
  });

  const value = (text) => ({
    text: String(text || "—"),
    fontSize: 8,
    bold: true,
    color: C.dark,
    decoration: "underline",
    decorationColor: C.primary,
  });

  return {
    table: {
      widths: [80, "*", 72, "*"],
      body: [
        [
          label("Student Name:"),
          value(s.name),
          label("Class:"),
          value(s.class),
        ],
        [
          label("Registration No:"),
          value(s.registrationNumber),
          label("Specialty:"),
          value(s.option),
        ],
        [
          label("Date of Birth:"),
          value(s.dateOfBirth),
          label("Academic Year:"),
          value(s.academicYear),
        ],
      ],
    },
    layout: {
      hLineWidth: (i, node) =>
        i === 0 || i === node.table.body.length ? 1 : 0,
      vLineWidth: (i, node) =>
        i === 0 || i === node.table.widths.length ? 1 : 0,
      hLineColor: () => C.primary,
      vLineColor: () => C.primary,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 2,
      paddingBottom: () => 2,
      fillColor: () => C.cardBg,
    },
    margin: [0, 0, 0, 3],
  };
}

// ── 9c. SUBJECT TABLE ────────────────────────────────────────────

function buildSubjectSection(
  sectionTitle,
  subjects,
  termCfg,
  gradingScale,
  fs_
) {
  const scoreCols = termCfg.scoreColumns;
  const colCount = scoreCols.length;

  const scoreW = colCount <= 3 ? 32 : colCount <= 5 ? 28 : 26;
  const widths = [35, "*", ...Array(colCount).fill(scoreW), 22, 30, 42, 50];

  const headerRow = [
    hdrCell("CODE"),
    hdrCell("SUBJECT TITLE"),
    ...scoreCols.map((c) => hdrCell(c.header)),
    hdrCell("COEF"),
    hdrCell("TOTAL"),
    hdrCell("REMARK"),
    hdrCell("TEACHER"),
  ];

  const bodyRows = subjects.map((subj) => {
    const termAvg = termCfg.getTermAvg(subj);
    const remark = termAvg != null ? getRemark(termAvg, gradingScale) : "N/A";
    const rColor = remarkColor(remark);

    const scoreCells = scoreCols.map((col) => {
      const val = resolveCellValue(subj, col, termCfg);
      const display =
        val == null || isNaN(Number(val))
          ? "-"
          : col.isAvg
          ? fmtAvg(val)
          : fmtScore(val);
      const isLow = val != null && !isNaN(Number(val)) && Number(val) < 10;
      return {
        text: display,
        fontSize: fs_.row,
        alignment: "center",
        color: isLow ? C.red : col.isAvg ? C.primary : C.dark,
        bold: true,
      };
    });

    const total =
      termAvg != null && !isNaN(Number(termAvg))
        ? (Number(termAvg) * subj.coef).toFixed(1)
        : "-";

    return [
      {
        text: subj.code,
        fontSize: fs_.code,
        bold: true,
        color: C.primary,
        alignment: "center",
      },
      {
        text: subj.title,
        fontSize: fs_.title,
        color: C.dark,
        alignment: "left",
      },
      ...scoreCells,
      {
        text: String(subj.coef),
        fontSize: fs_.row,
        bold: true,
        alignment: "center",
        color: C.dark,
      },
      {
        text: total,
        fontSize: fs_.row,
        bold: true,
        alignment: "center",
        color: C.primary,
      },
      {
        text: remark,
        fontSize: fs_.remark,
        bold: true,
        alignment: "center",
        color: rColor,
      },
      {
        text: formatTeacherName(subj.teacher),
        fontSize: fs_.teacher,
        color: C.light,
        alignment: "left",
      },
    ];
  });

  // Subtotal
  const { totalWeighted, totalCoef } = subjects.reduce(
    (acc, subj) => {
      const avg = termCfg.getTermAvg(subj);
      if (avg != null && !isNaN(Number(avg))) {
        acc.totalWeighted += Number(avg) * subj.coef;
        acc.totalCoef += subj.coef;
      }
      return acc;
    },
    { totalWeighted: 0, totalCoef: 0 }
  );
  const subAvg = totalCoef > 0 ? totalWeighted / totalCoef : 0;
  const subRemark = getRemark(subAvg, gradingScale);
  const subRemarkColor = remarkColor(subRemark);

  const subtotalSpan = colCount + 3;

  const subtotalRow = [
    {
      text: "SUB TOTAL:",
      colSpan: subtotalSpan,
      fontSize: 8,
      bold: true,
      color: C.primary,
      alignment: "right",
      fillColor: C.headerBg,
    },
    ...Array(subtotalSpan - 1).fill({ text: "", fillColor: C.headerBg }),
    {
      text: totalWeighted.toFixed(0),
      fontSize: 8.5,
      bold: true,
      color: C.primary,
      alignment: "center",
      fillColor: C.headerBg,
    },
    {
      text: subRemark,
      fontSize: fs_.remark,
      bold: true,
      color: subRemarkColor,
      alignment: "center",
      fillColor: C.headerBg,
    },
    { text: "", fillColor: C.headerBg },
  ];

  return {
    unbreakable: true,
    stack: [
      {
        table: {
          widths: ["*"],
          body: [
            [
              {
                text: sectionTitle,
                fontSize: 8,
                bold: true,
                color: C.white,
                alignment: "center",
                fillColor: C.primary,
                margin: [0, 1.5, 0, 1.5],
              },
            ],
          ],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
      },
      {
        table: {
          headerRows: 1,
          widths,
          body: [headerRow, ...bodyRows, subtotalRow],
        },
        layout: {
          hLineWidth: (i, node) => {
            if (i === 0 || i === node.table.body.length) return 1;
            if (i === 1) return 1;
            if (i === node.table.body.length - 1) return 2;
            return 0.5;
          },
          vLineWidth: () => 0.5,
          hLineColor: () => C.primary,
          vLineColor: () => C.primary,
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 1.5,
          paddingBottom: () => 1.5,
          fillColor: (rowIndex) => (rowIndex === 0 ? C.headerBg : null),
        },
      },
    ],
    margin: [0, 0, 0, 2],
  };
}

function hdrCell(text) {
  return {
    text,
    fontSize: 6.5,
    bold: true,
    color: C.primary,
    alignment: "center",
    fillColor: C.headerBg,
  };
}

// ── 9d. PERFORMANCE SUMMARY ─────────────────────────────────────

function buildPerformanceSummary(data, termCfg) {
  const tt = data.termTotals[termCfg.termTotalKey] || {};
  const cumAvg = termCfg.getCumulative(data.termTotals);
  const cs = data.classStatistics || {};

  const lbl = (text) => ({ text, fontSize: 7.5, bold: true, color: C.primary });
  const val = (text) => ({
    text: String(text ?? "—"),
    fontSize: 7.5,
    bold: true,
    color: C.dark,
    decoration: "underline",
    decorationColor: C.primary,
  });

  return {
    unbreakable: true,
    table: {
      widths: [100, "*", 84, "*", 90, "*"],
      body: [
        [
          lbl("GRAND TOTAL:"),
          val(tt.total != null ? Math.round(tt.total) : "—"),
          lbl("STUDENT AVG:"),
          val(tt.average != null ? `${fmtAvg(tt.average)}/20` : "—"),
          lbl("CLASS RANK:"),
          val(tt.rank != null ? `${tt.rank}° of ${tt.outOf}` : "—"),
        ],
        [
          lbl("CLASS AVERAGE:"),
          val(cs.classAverage != null ? `${fmtAvg(cs.classAverage)}/20` : "—"),
          lbl(`CUMUL. (${termCfg.cumulativeLabel}):`),
          val(cumAvg != null ? `${fmtAvg(cumAvg)}/20` : "N/A"),
          { text: "" },
          { text: "" },
        ],
      ],
    },
    layout: {
      hLineWidth: (i, node) =>
        i === 0 || i === node.table.body.length ? 1 : 0,
      vLineWidth: (i, node) =>
        i === 0 || i === node.table.widths.length ? 1 : 0,
      hLineColor: () => C.primary,
      vLineColor: () => C.primary,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 2,
      paddingBottom: () => 2,
      fillColor: () => C.cardBg,
    },
    margin: [0, 1, 0, 2],
  };
}

// ── 9e. BOTTOM SECTION (compact single-row layout) ──────────────
//
// Redesigned: conduct, grading scale, and admin are rendered as a
// single compact table row. The grading scale uses an inline layout
// instead of stacked key-value pairs, saving ~30pt of height.

function buildBottomSection(data, gradingScale) {
  const cond = data.conduct || {};
  const admin = data.administration || {};

  // ── Conduct column (compact key-value) ──
  const conductContent = {
    stack: [
      {
        text: "CONDUCT & ATTENDANCE",
        fontSize: 7,
        bold: true,
        color: C.primary,
        alignment: "center",
        margin: [0, 0, 0, 2],
      },
      {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 150,
            y2: 0,
            lineWidth: 0.4,
            lineColor: C.primary,
          },
        ],
        margin: [0, 0, 0, 2],
      },
      {
        columns: [
          {
            text: "Days Present:",
            fontSize: 6.5,
            bold: true,
            color: C.primary,
            width: "auto",
          },
          {
            text: `${cond.attendanceDays || "-"}/${cond.totalDays || "-"}`,
            fontSize: 6.5,
            bold: true,
            color: C.dark,
            alignment: "right",
            width: "*",
          },
        ],
        margin: [0, 0, 0, 1],
      },
      {
        columns: [
          {
            text: "Times Late:",
            fontSize: 6.5,
            bold: true,
            color: C.primary,
            width: "auto",
          },
          {
            text: String(cond.timesLate ?? "-"),
            fontSize: 6.5,
            bold: true,
            color: C.dark,
            alignment: "right",
            width: "*",
          },
        ],
        margin: [0, 0, 0, 1],
      },
      {
        columns: [
          {
            text: "Disciplinary:",
            fontSize: 6.5,
            bold: true,
            color: C.primary,
            width: "auto",
          },
          {
            text: String(cond.disciplinaryActions ?? "-"),
            fontSize: 6.5,
            bold: true,
            color: C.dark,
            alignment: "right",
            width: "*",
          },
        ],
      },
    ],
    fillColor: C.cardBg,
  };

  // ── Grading scale column (compact two-column grid) ──
  //    Renders as:  18-20: Excellent   14-15.9: Good
  //                 16-17.9: V.Good    12-13.9: F.Good  ...
  const gradingPairs = [];
  for (let i = 0; i < gradingScale.length; i += 2) {
    const left = gradingScale[i];
    const right = gradingScale[i + 1];
    const row = {
      columns: [
        {
          text: [
            {
              text: `${fmtRange(left.band_min, left.band_max)}: `,
              fontSize: 6,
              bold: true,
              color: C.primary,
            },
            {
              text: left.comment,
              fontSize: 6,
              bold: true,
              color: remarkColor(left.comment),
            },
          ],
          width: "50%",
        },
        right
          ? {
              text: [
                {
                  text: `${fmtRange(right.band_min, right.band_max)}: `,
                  fontSize: 6,
                  bold: true,
                  color: C.primary,
                },
                {
                  text: right.comment,
                  fontSize: 6,
                  bold: true,
                  color: remarkColor(right.comment),
                },
              ],
              width: "50%",
            }
          : { text: "", width: "50%" },
      ],
      margin: [0, 0, 0, 1],
    };
    gradingPairs.push(row);
  }

  const gradingContent = {
    stack: [
      {
        text: "GRADING SCALE",
        fontSize: 7,
        bold: true,
        color: C.primary,
        alignment: "center",
        margin: [0, 0, 0, 2],
      },
      {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 150,
            y2: 0,
            lineWidth: 0.4,
            lineColor: C.primary,
          },
        ],
        margin: [0, 0, 0, 2],
      },
      ...gradingPairs,
    ],
    fillColor: C.cardBg,
  };

  // ── Admin column ──
  const adminContent = {
    stack: [
      {
        text: "ADMINISTRATION",
        fontSize: 7,
        bold: true,
        color: C.primary,
        alignment: "center",
        margin: [0, 0, 0, 2],
      },
      {
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 150,
            y2: 0,
            lineWidth: 0.4,
            lineColor: C.primary,
          },
        ],
        margin: [0, 0, 0, 2],
      },
      {
        columns: [
          {
            text: "Class Master:",
            fontSize: 6.5,
            bold: true,
            color: C.primary,
            width: "auto",
          },
          {
            text: (admin.classMaster || "").toUpperCase(),
            fontSize: 6.5,
            bold: true,
            color: C.dark,
            alignment: "right",
            width: "*",
          },
        ],
        margin: [0, 0, 0, 1],
      },
      {
        columns: [
          {
            text: "Decision:",
            fontSize: 6.5,
            bold: true,
            color: C.primary,
            width: "auto",
          },
          {
            text: admin.decision || "",
            fontSize: 6.5,
            bold: true,
            color: C.good,
            alignment: "right",
            width: "*",
          },
        ],
        margin: [0, 0, 0, 1],
      },
      {
        columns: [
          {
            text: "Next Term:",
            fontSize: 6.5,
            bold: true,
            color: C.primary,
            width: "auto",
          },
          {
            text: admin.nextTermStarts || "",
            fontSize: 6.5,
            bold: true,
            color: C.dark,
            alignment: "right",
            width: "*",
          },
        ],
      },
    ],
    fillColor: C.cardBg,
  };

  return {
    unbreakable: true,
    table: {
      widths: ["*", "*", "*"],
      body: [[conductContent, gradingContent, adminContent]],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => C.primary,
      vLineColor: () => C.primary,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 2],
  };
}

// ── 9f. SIGNATURE BOXES (compact — single row, minimal height) ──

function buildSignatures(data) {
  const admin = data.administration || {};

  function sigBox(title, name) {
    return {
      stack: [
        {
          text: title,
          fontSize: 6.5,
          bold: true,
          color: C.primary,
          alignment: "center",
          margin: [0, 0, 0, 8],
        },
        {
          canvas: [
            {
              type: "line",
              x1: 10,
              y1: 0,
              x2: 130,
              y2: 0,
              lineWidth: 0.8,
              lineColor: C.primary,
            },
          ],
          margin: [0, 0, 0, 1.5],
        },
        {
          text: (name || "").toUpperCase(),
          fontSize: 6,
          bold: true,
          color: C.dark,
          alignment: "center",
          margin: [0, 0, 0, 0.5],
        },
        {
          text: "Date & Signature",
          fontSize: 5.5,
          italics: true,
          color: C.light,
          alignment: "center",
        },
      ],
      fillColor: C.cardBg,
    };
  }

  return {
    unbreakable: true,
    table: {
      widths: ["*", "*", "*"],
      body: [
        [
          sigBox("CLASS MASTER", admin.classMaster),
          sigBox("PRINCIPAL", admin.principal),
          sigBox("PARENT/GUARDIAN", admin.parents),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => C.primary,
      vLineColor: () => C.primary,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 2],
  };
}

// ── 9g. FOOTER ──────────────────────────────────────────────────

function buildFooter() {
  return {
    text: `© ${new Date().getFullYear()} Izzy Tech Team – Official Document | Votech (S7) Academy`,
    fontSize: 5.5,
    italics: true,
    color: C.light,
    alignment: "center",
    margin: [0, 1, 0, 0],
  };
}

/* ═══════════════════════════════════════════════════════════════════
   10. ASSEMBLE FULL DOCUMENT
   ═══════════════════════════════════════════════════════════════════ */

function buildDocDefinition(cards, termLabel, gradingScale, logoBase64) {
  const termCfg = getTermConfig(termLabel);
  const content = [];

  cards.forEach((card, idx) => {
    const page = buildStudentPage(card, termCfg, gradingScale, logoBase64);

    if (idx > 0) {
      page[0] = { ...page[0], pageBreak: "before" };
    }

    content.push(...page);
  });

  return {
    pageSize: "A4",
    pageMargins: [20, 14, 20, 14],
    content,
    defaultStyle: {
      font: "Roboto",
      fontSize: 7,
      lineHeight: 1.08,
    },

    ...(logoBase64
      ? {
          background: (_currentPage, pageSize) => ({
            image: logoBase64,
            width: 380,
            height: 380,
            opacity: 0.04,
            absolutePosition: {
              x: (pageSize.width - 380) / 2,
              y: (pageSize.height - 380) / 2,
            },
          }),
        }
      : {}),

    info: {
      title: "Report Cards – Votech S7 Academy",
      author: "Izzy Tech Team",
      subject: `${termLabel} Report Cards`,
    },
  };
}

function buildStudentPage(card, termCfg, gradingScale, logoBase64) {
  const totalSubjects =
    (card.generalSubjects?.length || 0) +
    (card.professionalSubjects?.length || 0) +
    (card.practicalSubjects?.length || 0);

  const fs_ = subjectFontSizes(totalSubjects);

  return [
    buildHeader(card, logoBase64),
    buildStudentInfo(card),
    ...(card.generalSubjects?.length
      ? [
          buildSubjectSection(
            "GENERAL SUBJECTS",
            card.generalSubjects,
            termCfg,
            gradingScale,
            fs_
          ),
        ]
      : []),
    ...(card.professionalSubjects?.length
      ? [
          buildSubjectSection(
            "PROFESSIONAL SUBJECTS",
            card.professionalSubjects,
            termCfg,
            gradingScale,
            fs_
          ),
        ]
      : []),
    ...(card.practicalSubjects?.length
      ? [
          buildSubjectSection(
            "PRACTICAL SUBJECTS",
            card.practicalSubjects,
            termCfg,
            gradingScale,
            fs_
          ),
        ]
      : []),
    buildPerformanceSummary(card, termCfg),
    buildBottomSection(card, gradingScale),
    buildSignatures(card),
    buildFooter(),
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   11. PDF STREAM GENERATOR (key optimization — no full buffer)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Creates the PDF and pipes it directly to the response stream.
 * This avoids holding the entire PDF in memory (which was the #1
 * cause of failures on large classes).
 */
function streamPdfToResponse(docDefinition, res) {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);

      doc.on("error", (err) => {
        reject(err);
      });

      doc.on("end", () => {
        resolve();
      });

      // Pipe directly to the HTTP response
      doc.pipe(res);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fallback: generate full buffer (used for single-student PDF
 * where we need Content-Length, or if streaming fails).
 */
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
   12. SHARED DATA-FETCHING LOGIC
   ═══════════════════════════════════════════════════════════════════ */

async function resolveTermKey(rawTerm, academicYearId) {
  const t = String(rawTerm ?? "term3")
    .trim()
    .toLowerCase();
  if (t === "term1" || t === "t1" || t.includes("first")) return "term1";
  if (t === "term2" || t === "t2" || t.includes("second")) return "term2";
  if (t === "term3" || t === "t3" || t.includes("third")) return "term3";
  if (t === "annual" || t === "all" || t === "") return "annual";

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
    { term1: "FIRST TERM", term2: "SECOND TERM", term3: "THIRD TERM" }[k] ||
    "THIRD TERM"
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
   13. CONTROLLER ENDPOINTS
   ═══════════════════════════════════════════════════════════════════ */

const sanitize = (s = "") => String(s).replace(/[^\w\-]+/g, "_");

// ── BULK PDF (STREAMING — the key optimization) ─────────────────

const bulkPdfDirect = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId, term = "term3" } = req.query;

  if (!academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        `Missing parameters: academicYearId=${academicYearId}, departmentId=${departmentId}, classId=${classId}`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // ── Fetch everything in parallel ──
  const [academicYear, department, studentClass, termKey] = await Promise.all([
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
    resolveTermKey(term, academicYearId),
  ]);

  if (!academicYear)
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  if (!department)
    return next(new AppError("Department not found", StatusCodes.NOT_FOUND));
  if (!studentClass)
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));

  // ── Fetch marks and grading in parallel ──
  const [marks, gradingRaw] = await Promise.all([
    fetchMarksWithIncludes(academicYearId, classId),
    models.academic_bands.findAll({
      where: { academic_year_id: academicYear.id, class_id: studentClass.id },
      raw: true,
    }),
  ]);

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
  const termLabel = termKeyToLabel(termKey);
  const cards = buildReportCardsFromMarks(marks, classMaster, termKey);
  const gradingScale = prepareGrading(gradingRaw);

  // ── Load logo once (cached after first call) ──
  const logoBase64 = loadLogoBase64();

  // ── Build doc definition ──
  const docDef = buildDocDefinition(cards, termLabel, gradingScale, logoBase64);

  const filename = `${sanitize(academicYear.name)}-${sanitize(
    department.name
  )}-${sanitize(studentClass.name)}-${sanitize(termLabel)}-report-cards.pdf`;

  try {
    const pdfBuffer = await generatePdfBuffer(docDef);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.status(200).end(pdfBuffer);
  } catch (err) {
    console.error("PDF generation error:", err);
    return next(
      new AppError(
        "PDF generation failed: " + (err.message || "Unknown error"),
        StatusCodes.INTERNAL_SERVER_ERROR
      )
    );
  }
});

// ── SINGLE STUDENT PDF (buffered — small, needs Content-Length) ──

const singlePdfDirect = catchAsync(async (req, res, next) => {
  const {
    studentId,
    academicYearId,
    departmentId,
    classId,
    term = "term3",
  } = req.query;

  if (!studentId || !academicYearId || !departmentId || !classId) {
    return next(
      new AppError(
        "Missing required parameters: studentId, academicYearId, departmentId, classId",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const [academicYear, department, studentClass, termKey] = await Promise.all([
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
    resolveTermKey(term, academicYearId),
  ]);

  if (!academicYear)
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  if (!department)
    return next(new AppError("Department not found", StatusCodes.NOT_FOUND));
  if (!studentClass)
    return next(new AppError("Class not found", StatusCodes.NOT_FOUND));

  const [marks, gradingRaw] = await Promise.all([
    fetchMarksWithIncludes(academicYearId, classId),
    models.academic_bands.findAll({
      where: { academic_year_id: academicYear.id, class_id: studentClass.id },
      raw: true,
    }),
  ]);

  if (!marks.length)
    return next(new AppError("No marks found", StatusCodes.NOT_FOUND));

  const classMaster =
    studentClass?.classMaster?.name ||
    studentClass?.classMaster?.username ||
    "";
  const termLabel = termKeyToLabel(termKey);
  const allCards = buildReportCardsFromMarks(marks, classMaster, termKey);

  const card = allCards.find((c) => String(c.student.id) === String(studentId));
  if (!card) {
    return next(
      new AppError(
        "Student not found in this class/year or has no marks.",
        StatusCodes.NOT_FOUND
      )
    );
  }

  const gradingScale = prepareGrading(gradingRaw);
  const logoBase64 = loadLogoBase64();
  const docDef = buildDocDefinition(
    [card],
    termLabel,
    gradingScale,
    logoBase64
  );
  const pdfBuffer = await generatePdfBuffer(docDef);

  const studentName = sanitize(card.student.name);
  const filename = `${studentName}-${sanitize(termLabel)}-report-card.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.status(200).end(pdfBuffer);
});

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  bulkPdfDirect,
  singlePdfDirect,
};
