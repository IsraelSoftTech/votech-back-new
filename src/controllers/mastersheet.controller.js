/* controllers/masterSheet.controller.js
 *
 * CLASS MASTER REPORT BOOKLET — OFFICIAL STUDENT MARKS RECORD
 * Core Layout Engine: pdfmake (No HTML / No Puppeteer)
 * Document Profile: Landscape A4, Premium Print Specification
 *
 * LAYOUT RULES (ENFORCED):
 * 1. NO side-by-side tables — ALL tables stack vertically (top-to-bottom)
 * 2. Maximum 8 subjects per page in any table with subject columns
 * 3. dontBreakRows: false on all large data tables for vertical flow
 * 4. All column widths validated against 792pt usable width
 * 5. No data is ever lost — overflow subjects continue on next page
 */

const PdfPrinter = require("pdfmake/src/printer");
const path = require("path");
const fs = require("fs");
const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const appResponder = require("../utils/appResponder");
const models = require("../models/index.model");
const { buildReportCardsFromMarks } = require("./reportCard.controller");

/* ═══════════════════════════════════════════════════════════════════
   1. FONT AND PRINTER INITIALIZATION
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
   2. PAGE GEOMETRY — HARD LIMITS
   Landscape A4: 841.89 x 595.28 pt
   Margins: 25pt each side → usable width = 841.89 - 50 = ~792pt
   ═══════════════════════════════════════════════════════════════════ */

const PAGE_USABLE_WIDTH = 680; // Reduced from 792 to absorb cumulative cell paddings
const MAX_SUBJECTS_PER_PAGE = 8; // HARD LIMIT — never exceed this

/* ═══════════════════════════════════════════════════════════════════
   3. BRANDING COLOR TOKENS
   ═══════════════════════════════════════════════════════════════════ */

const C = {
  navy: "#1e3a8a",
  gold: "#f59e0b",
  navyLight: "#2563eb",
  slate: "#4b5563",
  bgHeader: "#eff6ff",
  bgCard: "#ffffff",
  rowAlt: "#f7f8fa",
  white: "#ffffff",
  passGreen: "#16a34a",
  failRed: "#dc2626",
  warnOrange: "#ea580c",
  excellent: "#15803d",
  vgood: "#16a34a",
  good: "#1e3a8a",
  average: "#d97706",
  belowAvg: "#ea580c",
  weak: "#b91c1c",
};

const DEFAULT_GRADING = [
  { band_min: 18, band_max: 20, comment: "Excellent" },
  { band_min: 16, band_max: 17.99, comment: "Very Good" },
  { band_min: 13, band_max: 15.99, comment: "Good" },
  { band_min: 10, band_max: 12.99, comment: "Average" },
  { band_min: 6, band_max: 9.99, comment: "Below Average" },
  { band_min: 0, band_max: 5.99, comment: "Weak" },
];

/* ═══════════════════════════════════════════════════════════════════
   4. EVALUATION AND FORMATTING HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function prepareGrading(custom) {
  const arr = Array.isArray(custom) && custom.length ? custom : DEFAULT_GRADING;
  return arr.slice().sort((a, b) => b.band_min - a.band_min);
}

function getRemark(avg, scale) {
  if (avg == null || isNaN(Number(avg))) return "N/A";
  const band = scale.find((g) => avg >= g.band_min && avg <= g.band_max);
  return band ? band.comment : "N/A";
}

function getRemarkColor(remark) {
  const normalized = String(remark || "")
    .toLowerCase()
    .trim();
  if (normalized.includes("excellent")) return C.excellent;
  if (normalized.includes("very good") || normalized.includes("v.good"))
    return C.vgood;
  if (normalized.includes("good")) return C.good;
  if (normalized.includes("below")) return C.belowAvg;
  if (normalized.includes("average")) return C.average;
  return C.weak;
}

const roundNum = (n, d = 1) => Number(Number(n).toFixed(d));
const fmtAvg = (n) =>
  n == null || isNaN(Number(n)) ? "-" : Number(n).toFixed(1);
const fmtScore = (n) =>
  n == null || isNaN(Number(n)) ? "-" : String(Math.round(Number(n)));
const fmtPct = (n) =>
  n == null || isNaN(Number(n)) ? "-" : `${Number(n).toFixed(1)}%`;

function loadLogoBase64() {
  const logoPath = path.resolve(__dirname, "../../public/logo.png");
  if (!fs.existsSync(logoPath)) return null;
  return (
    "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64")
  );
}

function getAvgColor(v) {
  if (v == null || isNaN(Number(v))) return C.slate;
  return Number(v) < 10 ? C.failRed : Number(v) >= 14 ? C.passGreen : C.navy;
}

function getPctColor(v) {
  if (v == null) return C.slate;
  return v >= 75 ? C.passGreen : v >= 50 ? C.warnOrange : C.failRed;
}

function getTermInfo(termKey) {
  const map = {
    term1: {
      avgKey: "term1Avg",
      seqKeys: ["seq1", "seq2"],
      seqHeaders: ["Sequence 1", "Sequence 2"],
      avgLabel: "Term 1 Average",
      totalKey: "term1",
      label: "First Term Evaluation",
    },
    term2: {
      avgKey: "term2Avg",
      seqKeys: ["seq3", "seq4"],
      seqHeaders: ["Sequence 3", "Sequence 4"],
      avgLabel: "Term 2 Average",
      totalKey: "term2",
      label: "Second Term Evaluation",
    },
    term3: {
      avgKey: "term3Avg",
      seqKeys: ["seq5", "seq6"],
      seqHeaders: ["Sequence 5", "Sequence 6"],
      avgLabel: "Term 3 Average",
      totalKey: "term3",
      label: "Third Term Evaluation",
    },
    annual: {
      avgKey: "finalAvg",
      seqKeys: ["term1Avg", "term2Avg", "term3Avg"],
      seqHeaders: ["Term 1 Avg", "Term 2 Avg", "Term 3 Avg"],
      avgLabel: "Annual Average",
      totalKey: "annual",
      label: "Annual Academic Year Record",
    },
  };
  return map[termKey] || map.term3;
}

/* ═══════════════════════════════════════════════════════════════════
   5. DATA ANALYSIS ENGINE
   ═══════════════════════════════════════════════════════════════════ */

function analyzeMasterSheet(cards, termKey, gradingScale) {
  const ti = getTermInfo(termKey);
  const genSubjects = [],
    profSubjects = [],
    pracSubjects = [];
  const trackedCodes = new Set();

  for (const card of cards) {
    const processCategory = (targetArr, subjectList, label) => {
      for (const s of subjectList || []) {
        if (!trackedCodes.has(s.code)) {
          trackedCodes.add(s.code);
          targetArr.push({
            code: s.code,
            title: s.title,
            coef: s.coef,
            teacher: s.teacher,
            category: label,
          });
        }
      }
    };
    processCategory(genSubjects, card.generalSubjects, "general");
    processCategory(profSubjects, card.professionalSubjects, "professional");
    processCategory(pracSubjects, card.practicalSubjects, "practical");
  }
  const allSubjects = [...genSubjects, ...profSubjects, ...pracSubjects];

  const students = cards
    .map((card) => {
      const totals = card.termTotals[ti.totalKey] || {};
      const consolidated = [
        ...(card.generalSubjects || []),
        ...(card.professionalSubjects || []),
        ...(card.practicalSubjects || []),
      ];
      const scores = {};
      for (const s of consolidated) {
        scores[s.code] = {
          ...s.scores,
          average: s.scores[ti.avgKey],
          coef: s.coef,
        };
      }
      const calcStreamAvg = (streamList) => {
        let weightedSum = 0,
          totalCoef = 0;
        for (const s of streamList) {
          const entry = scores[s.code];
          if (entry && entry.average != null && !isNaN(Number(entry.average))) {
            weightedSum += Number(entry.average) * s.coef;
            totalCoef += s.coef;
          }
        }
        return totalCoef > 0 ? roundNum(weightedSum / totalCoef) : null;
      };
      return {
        id: card.student.id,
        name: card.student.name,
        regNo: card.student.registrationNumber,
        scores,
        genAvg: calcStreamAvg(genSubjects),
        profAvg: calcStreamAvg(profSubjects),
        pracAvg: calcStreamAvg(pracSubjects),
        total: totals.total,
        average: totals.average,
        rank: totals.rank,
        outOf: totals.outOf,
      };
    })
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));

  const subjectStats = allSubjects
    .map((subj) => {
      const rawScores = [],
        roster = [];
      for (const st of students) {
        const entry = st.scores[subj.code];
        if (entry && entry.average != null && !isNaN(Number(entry.average))) {
          rawScores.push(Number(entry.average));
          roster.push({ name: st.name, score: Number(entry.average) });
        }
      }
      if (!rawScores.length) {
        return {
          ...subj,
          classAvg: null,
          highest: null,
          lowest: null,
          passed: 0,
          failed: 0,
          passRate: 0,
          failRate: 0,
          top3: [],
          bottom3: [],
          count: 0,
        };
      }
      const sortedRoster = roster.sort((a, b) => b.score - a.score);
      const classAvg = roundNum(
        rawScores.reduce((a, b) => a + b, 0) / rawScores.length
      );
      const passed = rawScores.filter((v) => v >= 10).length;
      const failed = rawScores.length - passed;
      return {
        ...subj,
        classAvg,
        highest: sortedRoster[0]?.score,
        lowest: sortedRoster[sortedRoster.length - 1]?.score,
        passed,
        failed,
        passRate: roundNum((passed / rawScores.length) * 100),
        failRate: roundNum((failed / rawScores.length) * 100),
        top3: sortedRoster.slice(0, 3),
        bottom3: sortedRoster.slice(-3).reverse(),
        count: rawScores.length,
      };
    })
    .sort((a, b) => (b.classAvg || 0) - (a.classAvg || 0));

  const validAverages = students
    .map((s) => s.average)
    .filter((a) => a != null && !isNaN(Number(a)) && Number(a) > 0);
  const corePassed = validAverages.filter((a) => a >= 10).length;
  const coreFailed = validAverages.length - corePassed;

  const overallStats = {
    totalStudents: students.length,
    classAverage: validAverages.length
      ? roundNum(
          validAverages.reduce((a, b) => a + b, 0) / validAverages.length
        )
      : 0,
    highest: validAverages.length ? roundNum(Math.max(...validAverages)) : 0,
    highestStudent: students[0]?.name || "N/A",
    lowest: validAverages.length ? roundNum(Math.min(...validAverages)) : 0,
    lowestStudent: students[students.length - 1]?.name || "N/A",
    passed: corePassed,
    failed: coreFailed,
    passRate: validAverages.length
      ? roundNum((corePassed / validAverages.length) * 100)
      : 0,
    failRate: validAverages.length
      ? roundNum((coreFailed / validAverages.length) * 100)
      : 0,
  };

  const distribution = gradingScale.map((band) => {
    const metrics = {
      label: band.comment,
      min: band.band_min,
      max: band.band_max,
      count: 0,
      perSubject: {},
    };
    for (const s of allSubjects) metrics.perSubject[s.code] = 0;
    for (const st of students) {
      if (
        st.average != null &&
        st.average >= band.band_min &&
        st.average <= band.band_max
      )
        metrics.count++;
      for (const s of allSubjects) {
        const mark = st.scores[s.code]?.average;
        if (mark != null && mark >= band.band_min && mark <= band.band_max)
          metrics.perSubject[s.code]++;
      }
    }
    return metrics;
  });

  const failingStudents = students
    .filter((s) => s.average != null && s.average < 10)
    .map((s) => {
      const targets = allSubjects
        .filter(
          (subj) =>
            s.scores[subj.code]?.average != null &&
            s.scores[subj.code].average < 10
        )
        .map((subj) => ({
          code: subj.code,
          score: s.scores[subj.code].average,
        }))
        .sort((a, b) => a.score - b.score);
      return { ...s, deficiencies: targets, totalFailed: targets.length };
    });

  const computeCategoryAverages = (list) => {
    const filters = list.map((s) => s.classAvg).filter((v) => v != null);
    if (!filters.length) return { avg: null, passRate: 0 };
    return {
      avg: roundNum(filters.reduce((a, b) => a + b, 0) / filters.length),
      passRate: roundNum(
        list.reduce((sum, item) => sum + item.passRate, 0) / list.length
      ),
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
    genStats: computeCategoryAverages(
      subjectStats.filter((s) => s.category === "general")
    ),
    profStats: computeCategoryAverages(
      subjectStats.filter((s) => s.category === "professional")
    ),
    pracStats: computeCategoryAverages(
      subjectStats.filter((s) => s.category === "practical")
    ),
    termInfo: ti,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   6. LAYOUT BUILDING BLOCKS
   ═══════════════════════════════════════════════════════════════════ */

function makeChapterHeader(titleText, blockId) {
  const titleObj = {
    text: titleText.toUpperCase(),
    fontSize: 10,
    bold: true,
    color: C.white,
    alignment: "center",
    fillColor: C.navy,
    margin: [0, 5, 0, 5],
  };
  if (blockId) titleObj.id = blockId;
  return {
    table: { widths: ["*"], body: [[titleObj]] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: [0, 0, 0, 10],
  };
}

function makeStatCard(title, valueText, displayColor = C.navy) {
  return {
    stack: [
      {
        text: title.toUpperCase(),
        fontSize: 7,
        bold: true,
        color: C.slate,
        alignment: "center",
        margin: [0, 0, 0, 3],
      },
      {
        text: String(valueText ?? "-"),
        fontSize: 11,
        bold: true,
        color: displayColor,
        alignment: "center",
      },
    ],
    margin: [2, 4, 2, 4],
  };
}

function getTableLayoutSpec(options = {}) {
  return {
    hLineWidth: (i, node) =>
      i === 0 || i === node.table.body.length || i === 1 ? 1.2 : 0.3,
    vLineWidth: (i, node) =>
      i === 0 || i === node.table.widths.length ? 1.2 : 0.3,
    hLineColor: () => C.navy,
    vLineColor: () => C.navy,
    paddingLeft: () => options.px || 4,
    paddingRight: () => options.px || 4,
    paddingTop: () => options.py || 3,
    paddingBottom: () => options.py || 3,
    fillColor: (rowIndex) => {
      if (rowIndex === 0) return C.bgHeader;
      if (options.zebra && rowIndex % 2 === 0) return C.rowAlt;
      return null;
    },
  };
}

const buildGridHeader = (label, alignment = "center", fontSize = 7.5) => ({
  text: label,
  fontSize,
  bold: true,
  color: C.navy,
  alignment,
  fillColor: C.bgHeader,
});

const buildGridCell = (
  val,
  alignment = "center",
  bold = false,
  textColor = C.slate,
  bg = null
) => ({
  text: String(val ?? "-"),
  fontSize: 7.5,
  bold,
  color: textColor,
  alignment,
  fillColor: bg,
});

/* ═══════════════════════════════════════════════════════════════════
   HELPER: Chunk an array into groups of N
   ═══════════════════════════════════════════════════════════════════ */

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 1: COVER PAGE & TABLE OF CONTENTS
   ═══════════════════════════════════════════════════════════════════ */

function layoutCoverPage(meta, analysis, logoBase64) {
  const elements = [];

  if (logoBase64) {
    // References the image registered once in buildMasterSheetDoc's
    // returned docDefinition.images, not the raw base64 string, same fix
    // (and same reason) as reportCardPdfGenerator.js's buildHeader.
    elements.push({
      image: "reportLogo",
      width: 75,
      height: 75,
      alignment: "center",
      margin: [0, 0, 0, 10],
    });
  }

  elements.push(
    {
      text: meta.schoolName.toUpperCase(),
      fontSize: 16,
      bold: true,
      color: C.navy,
      alignment: "center",
      characterSpacing: 1.2,
      margin: [0, 0, 0, 2],
    },
    {
      text: "REPUBLIC OF CAMEROON | SCHOOL ACADEMIC RECORDS",
      fontSize: 8,
      bold: true,
      color: C.slate,
      alignment: "center",
      margin: [0, 0, 0, 2],
    },
    {
      text: "Motto: Welfare | Productivity | Self Actualization",
      fontSize: 8,
      italics: true,
      color: C.gold,
      alignment: "center",
      margin: [0, 0, 0, 6],
    },
    {
      canvas: [
        {
          type: "line",
          x1: 100,
          y1: 0,
          x2: 692,
          y2: 0,
          lineWidth: 1.5,
          lineColor: C.gold,
        },
      ],
      margin: [0, 0, 0, 10],
    },
    {
      text: "CLASS MASTER REPORT BOOKLET",
      fontSize: 18,
      bold: true,
      color: C.navy,
      alignment: "center",
      characterSpacing: 1.5,
      margin: [0, 0, 0, 4],
    },
    {
      text: `${analysis.termInfo.label.toUpperCase()} | SCHOOL YEAR: ${
        meta.academicYear
      }`,
      fontSize: 11,
      bold: true,
      color: C.gold,
      alignment: "center",
      margin: [0, 0, 0, 4],
    },
    {
      text: `CLASS: ${meta.className} | DEPARTMENT: ${meta.departmentName}`,
      fontSize: 10,
      bold: true,
      color: C.slate,
      alignment: "center",
      margin: [0, 0, 0, 2],
    },
    {
      text: `Class Master: ${meta.classMaster || "Not Assigned"}`,
      fontSize: 9,
      italics: true,
      color: C.slate,
      alignment: "center",
      margin: [0, 0, 0, 15],
    }
  );

  const buildTocRow = (title, refId) => [
    buildGridCell(title, "left"),
    {
      text: ["Page ", { pageReference: refId }],
      fontSize: 7.5,
      bold: true,
      color: C.navy,
      alignment: "center",
      margin: [0, 1, 0, 1],
    },
  ];

  elements.push(makeChapterHeader("TABLE OF CONTENTS", "chap1"), {
    table: {
      dontBreakRows: true,
      widths: ["*", 80],
      body: [
        [
          buildGridHeader("STRUCTURAL REPORT CHAPTERS", "left", 8),
          buildGridHeader("PAGE LOCATION", "center", 8),
        ],
        buildTocRow("Chapter 1: Cover Page and Table of Contents", "chap1"),
        buildTocRow(
          "Chapter 2: Term Summary and General Performance Analysis",
          "chap2"
        ),
        buildTocRow(
          "Chapter 3: Class Positions and Subject Marks Record",
          "chap3"
        ),
        buildTocRow("Chapter 4: Sequence Marks Breakdown", "chap4"),
        buildTocRow(
          "Chapter 5: Subject Performance Ranking (Best to Worst)",
          "chap5"
        ),
        buildTocRow("Chapter 6: Grade Distribution and Analysis", "chap6"),
        buildTocRow(
          "Chapter 7: Best Students and Students Who Need Help",
          "chap7"
        ),
        buildTocRow(
          "Chapter 8: Official Signatures and Stamp Validation",
          "chap8"
        ),
      ],
    },
    layout: getTableLayoutSpec({ zebra: true }),
    margin: [50, 0, 50, 0],
  });

  return elements;
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 2: TERM SUMMARY & GENERAL ANALYSIS
   ═══════════════════════════════════════════════════════════════════ */

function layoutExecutiveSummary(analysis) {
  const { overallStats: os, students } = analysis;

  // Stats: 3 cards per row × 2 rows — always fits
  const statRow1 = {
    table: {
      dontBreakRows: true,
      widths: ["*", "*", "*"],
      body: [
        [
          makeStatCard("Total Students", os.totalStudents),
          makeStatCard(
            "Class Average",
            `${fmtAvg(os.classAverage)}/20`,
            getAvgColor(os.classAverage)
          ),
          makeStatCard("Highest Average", fmtAvg(os.highest), C.passGreen),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1.5,
      vLineWidth: () => 1,
      hLineColor: () => C.navy,
      vLineColor: () => C.navy,
      fillColor: () => C.bgCard,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 0, 0, 4],
  };

  const statRow2 = {
    table: {
      dontBreakRows: true,
      widths: ["*", "*", "*"],
      body: [
        [
          makeStatCard(
            "Lowest Average",
            fmtAvg(os.lowest),
            os.lowest < 10 ? C.failRed : C.slate
          ),
          makeStatCard(
            "Students Passed",
            `${os.passed} (${fmtPct(os.passRate)})`,
            C.passGreen
          ),
          makeStatCard(
            "Students Failed",
            `${os.failed} (${fmtPct(os.failRate)})`,
            os.failed > 0 ? C.failRed : C.passGreen
          ),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1.5,
      vLineWidth: () => 1,
      hLineColor: () => C.navy,
      vLineColor: () => C.navy,
      fillColor: () => C.bgCard,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 0, 0, 15],
  };

  // Top 3 and Bottom 3 — STACKED VERTICALLY (no columns)
  const makeLeaderTable = (rows, titleText, titleColor) => [
    {
      text: titleText,
      fontSize: 8,
      bold: true,
      color: titleColor,
      margin: [0, 0, 0, 4],
    },
    {
      table: {
        dontBreakRows: true,
        widths: [30, "*", 60],
        body: [
          [
            buildGridHeader("Rank"),
            buildGridHeader("Student Name", "left"),
            buildGridHeader("Average"),
          ],
          ...rows,
        ],
      },
      layout: getTableLayoutSpec({ zebra: true }),
      margin: [0, 0, 0, 12],
    },
  ];

  const top3Rows = students
    .slice(0, 3)
    .map((st, i) => [
      buildGridCell(i + 1, "center", true),
      buildGridCell(st.name, "left", true, C.navy),
      buildGridCell(fmtAvg(st.average), "center", true, C.passGreen),
    ]);

  const bot3Rows = students
    .slice()
    .reverse()
    .slice(0, 3)
    .map((st, i) => [
      buildGridCell(students.length - i, "center", true),
      buildGridCell(st.name, "left", true, C.navy),
      buildGridCell(fmtAvg(st.average), "center", true, C.failRed),
    ]);

  // Stream table — FULL WIDTH, stacked below
  const streamTable = {
    table: {
      dontBreakRows: true,
      headerRows: 1,
      widths: ["*", 80, 110, 110],
      body: [
        [
          buildGridHeader("SUBJECT CATEGORY", "left"),
          buildGridHeader("TOTAL SUBJECTS"),
          buildGridHeader("CATEGORY AVERAGE"),
          buildGridHeader("PASS RATE (%)"),
        ],
        [
          buildGridCell("General Core Subjects", "left", true, C.navy),
          buildGridCell(analysis.genSubjects.length),
          buildGridCell(
            analysis.genStats.avg != null
              ? fmtAvg(analysis.genStats.avg)
              : "N/A",
            "center",
            true,
            getAvgColor(analysis.genStats.avg)
          ),
          buildGridCell(
            fmtPct(analysis.genStats.passRate),
            "center",
            true,
            getPctColor(analysis.genStats.passRate)
          ),
        ],
        [
          buildGridCell(
            "Professional Technical Subjects",
            "left",
            true,
            C.navy
          ),
          buildGridCell(analysis.profSubjects.length),
          buildGridCell(
            analysis.profStats.avg != null
              ? fmtAvg(analysis.profStats.avg)
              : "N/A",
            "center",
            true,
            getAvgColor(analysis.profStats.avg)
          ),
          buildGridCell(
            fmtPct(analysis.profStats.passRate),
            "center",
            true,
            getPctColor(analysis.profStats.passRate)
          ),
        ],
        [
          buildGridCell("Practical Workshop Subjects", "left", true, C.navy),
          buildGridCell(analysis.pracSubjects.length),
          buildGridCell(
            analysis.pracStats.avg != null
              ? fmtAvg(analysis.pracStats.avg)
              : "N/A",
            "center",
            true,
            getAvgColor(analysis.pracStats.avg)
          ),
          buildGridCell(
            fmtPct(analysis.pracStats.passRate),
            "center",
            true,
            getPctColor(analysis.pracStats.passRate)
          ),
        ],
      ],
    },
    layout: getTableLayoutSpec(),
    margin: [0, 0, 0, 0],
  };

  return [
    makeChapterHeader(
      "CHAPTER 2: TERM SUMMARY AND GENERAL PERFORMANCE ANALYSIS",
      "chap2"
    ),
    {
      text: "GENERAL PERFORMANCE SUMMARY",
      fontSize: 8.5,
      bold: true,
      color: C.navy,
      margin: [0, 0, 0, 5],
    },
    statRow1,
    statRow2,
    ...makeLeaderTable(top3Rows, "TOP 3 BEST PERFORMING STUDENTS", C.passGreen),
    ...makeLeaderTable(bot3Rows, "BOTTOM 3 STUDENTS WHO NEED HELP", C.failRed),
    {
      text: "PERFORMANCE SUMMARY BY SUBJECT CATEGORY",
      fontSize: 8.5,
      bold: true,
      color: C.navy,
      margin: [0, 0, 0, 5],
    },
    streamTable,
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 3: CLASS POSITIONS & SUBJECT MARKS RECORD
   RULE: Maximum 8 subjects per table page.
         Summary columns (GenAvg, ProfAvg, PracAvg, TermAvg, Remark)
         appear ONLY on the LAST chunk.
   ═══════════════════════════════════════════════════════════════════ */

function layoutMarksOverview(analysis, gradingScale) {
  const { students, allSubjects } = analysis;
  const elements = [
    makeChapterHeader(
      "CHAPTER 3: CLASS POSITIONS AND SUBJECT MARKS RECORD",
      "chap3"
    ),
  ];

  const chunks = chunkArray(allSubjects, MAX_SUBJECTS_PER_PAGE);
  const totalChunks = chunks.length;

  chunks.forEach((chunk, chunkIdx) => {
    const isLastChunk = chunkIdx === totalChunks - 1;
    const isFirstChunk = chunkIdx === 0;

    if (!isFirstChunk) {
      elements.push({ text: "", pageBreak: "before" });
      elements.push({
        text: `CLASS MARKS RECORD (CONTINUED — PAGE ${
          chunkIdx + 1
        } OF ${totalChunks})`,
        fontSize: 8,
        bold: true,
        color: C.navy,
        margin: [0, 0, 0, 6],
      });
    }

    // Calculate column widths for this chunk
    // Calculate column widths for this chunk
    const RANK_W = 22;
    const MATH_NAME_W = 100; // Used for math only
    const GEN_W = 28;
    const PROF_W = 28;
    const PRAC_W = 28;
    const TERM_W = 32;
    const REMARK_W = 50;

    const fixedW =
      RANK_W +
      MATH_NAME_W +
      (isLastChunk ? GEN_W + PROF_W + PRAC_W + TERM_W + REMARK_W : 0);

    const availForSubjects = PAGE_USABLE_WIDTH - fixedW;
    const subjectColW = Math.max(
      18,
      Math.floor(availForSubjects / chunk.length)
    );

    const fontSz = chunk.length > 6 ? 6 : 6.5;

    // USE "*" FOR THE NAME COLUMN SO PDFMAKE HANDLES THE FLEX
    const widths = [RANK_W, "*", ...chunk.map(() => subjectColW)];
    if (isLastChunk) widths.push(GEN_W, PROF_W, PRAC_W, TERM_W, REMARK_W);
    // Header
    const headerRow = [
      buildGridHeader("Rank", "center", fontSz),
      buildGridHeader("STUDENT FULL NAME", "left", fontSz),
      ...chunk.map((s) => buildGridHeader(s.code, "center", fontSz)),
    ];
    if (isLastChunk) {
      headerRow.push(
        buildGridHeader("GEN\nAVG", "center", fontSz),
        buildGridHeader("PROF\nAVG", "center", fontSz),
        buildGridHeader("PRAC\nAVG", "center", fontSz),
        buildGridHeader("TERM\nAVG", "center", fontSz + 0.5),
        buildGridHeader("REMARK", "center", fontSz)
      );
    }

    // Data rows
    const gridRows = students.map((st, rIdx) => {
      const bgRow = rIdx % 2 === 0 ? null : C.rowAlt;
      const evaluation = getRemark(st.average, gradingScale);

      const row = [
        {
          text: String(st.rank),
          fontSize: fontSz,
          bold: true,
          alignment: "center",
          fillColor: bgRow,
        },
        {
          text: st.name,
          fontSize: fontSz,
          alignment: "left",
          fillColor: bgRow,
        },
        ...chunk.map((s) => {
          const mark = st.scores[s.code]?.average;
          return {
            text: fmtAvg(mark),
            fontSize: fontSz,
            alignment: "center",
            color: mark != null && Number(mark) < 10 ? C.failRed : C.slate,
            fillColor: bgRow,
          };
        }),
      ];

      if (isLastChunk) {
        row.push(
          {
            text: fmtAvg(st.genAvg),
            fontSize: fontSz,
            bold: true,
            color: getAvgColor(st.genAvg),
            alignment: "center",
            fillColor: bgRow,
          },
          {
            text: fmtAvg(st.profAvg),
            fontSize: fontSz,
            bold: true,
            color: getAvgColor(st.profAvg),
            alignment: "center",
            fillColor: bgRow,
          },
          {
            text: fmtAvg(st.pracAvg),
            fontSize: fontSz,
            bold: true,
            color: getAvgColor(st.pracAvg),
            alignment: "center",
            fillColor: bgRow,
          },
          {
            text: fmtAvg(st.average),
            fontSize: fontSz + 0.5,
            bold: true,
            color: getAvgColor(st.average),
            alignment: "center",
            fillColor: bgRow,
          },
          {
            text: evaluation,
            fontSize: fontSz - 0.5,
            bold: true,
            color: getRemarkColor(evaluation),
            alignment: "center",
            fillColor: bgRow,
          }
        );
      }
      return row;
    });

    // Footer stat rows for this chunk's subjects
    const totalCols = widths.length;
    const makeFooterRow = (label, key, formatter, colorFn) => {
      const row = [
        { text: "", fillColor: C.bgHeader },
        {
          text: label,
          fontSize: fontSz,
          bold: true,
          color: C.navy,
          alignment: "left",
          fillColor: C.bgHeader,
        },
        ...chunk.map((s) => {
          const match = analysis.subjectStats.find(
            (item) => item.code === s.code
          );
          const val = match ? match[key] : null;
          return {
            text: formatter(val),
            fontSize: fontSz,
            bold: true,
            color: colorFn ? colorFn(val) : C.navy,
            alignment: "center",
            fillColor: C.bgHeader,
          };
        }),
      ];
      // Fill remaining columns for last chunk
      if (isLastChunk) {
        for (let k = 0; k < 5; k++)
          row.push({ text: "", fillColor: C.bgHeader });
      }
      return row;
    };

    const footerRows = [
      makeFooterRow("SUBJECT AVERAGE", "classAvg", fmtAvg, getAvgColor),
      makeFooterRow("HIGHEST MARK", "highest", fmtAvg, () => C.passGreen),
      makeFooterRow("LOWEST MARK", "lowest", fmtAvg, (v) =>
        v != null && v < 10 ? C.failRed : C.slate
      ),
      makeFooterRow("PASS RATE (%)", "passRate", fmtPct, getPctColor),
    ];

    elements.push({
      table: {
        dontBreakRows: false,
        headerRows: 1,
        widths,
        body: [headerRow, ...gridRows, ...footerRows],
      },
      layout: {
        hLineWidth: (i, node) =>
          i === 0 || i === node.table.body.length
            ? 1.2
            : i === 1 || i === node.table.body.length - 4
            ? 1.2
            : 0.2,
        vLineWidth: (i, node) =>
          i === 0 || i === node.table.widths.length || i === 2 ? 0.6 : 0.2,
        hLineColor: () => C.navy,
        vLineColor: () => C.navy,
        paddingLeft: () => 1.5,
        paddingRight: () => 1.5,
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
      margin: [0, 0, 0, 8],
    });
  });

  return elements;
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 4: SEQUENCE MARKS BREAKDOWN
   RULE: Maximum 8 subjects per table. Each subject takes
         (seqCount + 1) sub-columns. Tables chunked and stacked.
   ═══════════════════════════════════════════════════════════════════ */

function layoutDetailedSequences(analysis) {
  const { students, termInfo: ti } = analysis;
  const layoutStack = [];

  layoutStack.push(
    makeChapterHeader(
      `CHAPTER 4: SEQUENCE MARKS BREAKDOWN (${analysis.termInfo.label})`,
      "chap4"
    )
  );

  const SEQ_COL_W = 22;
  const AVG_COL_W = 26;
  const RANK_W = 20;
  const MATH_NAME_W = 100; // Used for math only
  const CAT_AVG_W = 30;

  const seqCount = ti.seqKeys.length;
  const colsPerSubject = seqCount + 1; // seq cols + avg col
  const widthPerSubject = seqCount * SEQ_COL_W + AVG_COL_W;

  // Calculate max subjects per page for sequence tables
  const FIXED_W = RANK_W + MATH_NAME_W + CAT_AVG_W;
  const AVAIL_W = PAGE_USABLE_WIDTH - FIXED_W;
  const maxSubjectsSeq = Math.min(
    MAX_SUBJECTS_PER_PAGE,
    Math.max(1, Math.floor(AVAIL_W / widthPerSubject))
  );

  const compileSequenceBlock = (headerTitle, streamList, contextKey) => {
    if (!streamList.length) return;

    const subjChunks = chunkArray(streamList, maxSubjectsSeq);
    const totalChunks = subjChunks.length;
    const fontSz = 6;

    subjChunks.forEach((chunk, chunkIdx) => {
      // ... (keep the page break and title logic exactly as it is) ...

      // Build widths: USE "*" FOR THE NAME COLUMN
      const widths = [RANK_W, "*"];
      chunk.forEach(() => {
        for (let k = 0; k < seqCount; k++) widths.push(SEQ_COL_W);
        widths.push(AVG_COL_W);
      });
      widths.push(CAT_AVG_W);

      // Header row 1
      const primaryHeader = [
        {
          text: "Pos",
          rowSpan: 2,
          fontSize: fontSz,
          bold: true,
          color: C.navy,
          alignment: "center",
          fillColor: C.bgHeader,
        },
        {
          text: "STUDENT FULL NAME",
          rowSpan: 2,
          fontSize: fontSz,
          bold: true,
          color: C.navy,
          alignment: "left",
          fillColor: C.bgHeader,
        },
      ];
      chunk.forEach((s) => {
        primaryHeader.push({
          text: s.code,
          colSpan: colsPerSubject,
          fontSize: fontSz,
          bold: true,
          color: C.navy,
          alignment: "center",
          fillColor: C.bgHeader,
        });
        for (let k = 1; k < colsPerSubject; k++)
          primaryHeader.push({ text: "", fillColor: C.bgHeader });
      });
      primaryHeader.push({
        text: "CAT\nAVG",
        rowSpan: 2,
        fontSize: fontSz,
        bold: true,
        color: C.navy,
        alignment: "center",
        fillColor: C.bgHeader,
      });

      // Header row 2
      const secondaryHeader = [
        { text: "", fillColor: C.bgHeader },
        { text: "", fillColor: C.bgHeader },
      ];
      chunk.forEach(() => {
        ti.seqHeaders.forEach((label) => {
          secondaryHeader.push({
            text: label.replace("Sequence ", "S"),
            fontSize: fontSz - 1,
            bold: true,
            color: C.navy,
            alignment: "center",
            fillColor: C.bgHeader,
          });
        });
        secondaryHeader.push({
          text: "Avg",
          fontSize: fontSz - 1,
          bold: true,
          color: C.navy,
          alignment: "center",
          fillColor: C.bgHeader,
        });
      });
      secondaryHeader.push({ text: "", fillColor: C.bgHeader });

      // Data rows
      const matrixRows = students.map((st, idx) => {
        const lineBg = idx % 2 === 0 ? null : C.rowAlt;
        const row = [
          {
            text: String(st.rank),
            fontSize: fontSz,
            bold: true,
            alignment: "center",
            fillColor: lineBg,
          },
          {
            text: st.name,
            fontSize: fontSz,
            alignment: "left",
            fillColor: lineBg,
          },
        ];
        chunk.forEach((s) => {
          const profile = st.scores[s.code] || {};
          ti.seqKeys.forEach((key) => {
            const actualMark = profile[key];
            row.push({
              text:
                actualMark != null && !isNaN(Number(actualMark))
                  ? ti.totalKey === "annual"
                    ? fmtAvg(actualMark)
                    : fmtScore(actualMark)
                  : "-",
              fontSize: fontSz,
              alignment: "center",
              color:
                actualMark != null && Number(actualMark) < 10
                  ? C.failRed
                  : C.slate,
              fillColor: lineBg,
            });
          });
          row.push({
            text: fmtAvg(profile.average),
            fontSize: fontSz,
            bold: true,
            alignment: "center",
            color: getAvgColor(profile.average),
            fillColor: lineBg,
          });
        });
        row.push({
          text: fmtAvg(st[contextKey]),
          fontSize: fontSz,
          bold: true,
          alignment: "center",
          color: getAvgColor(st[contextKey]),
          fillColor: lineBg,
        });
        return row;
      });

      layoutStack.push({
        table: {
          dontBreakRows: false,
          headerRows: 2,
          widths,
          body: [primaryHeader, secondaryHeader, ...matrixRows],
        },
        layout: {
          hLineWidth: (i, node) =>
            i === 0 || i === node.table.body.length ? 1.2 : i <= 2 ? 1 : 0.15,
          vLineWidth: (i, node) =>
            i === 0 || i === node.table.widths.length || i === 2 ? 0.6 : 0.15,
          hLineColor: () => C.navy,
          vLineColor: () => C.navy,
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
        margin: [0, 0, 0, 10],
      });
    });
  };

  compileSequenceBlock("GENERAL CORE SUBJECTS", analysis.genSubjects, "genAvg");

  if (analysis.profSubjects.length) {
    layoutStack.push({ text: "", pageBreak: "before" });
    compileSequenceBlock(
      "PROFESSIONAL TECHNICAL SUBJECTS",
      analysis.profSubjects,
      "profAvg"
    );
  }
  if (analysis.pracSubjects.length) {
    layoutStack.push({ text: "", pageBreak: "before" });
    compileSequenceBlock(
      "PRACTICAL WORKSHOP SUBJECTS",
      analysis.pracSubjects,
      "pracAvg"
    );
  }

  return layoutStack;
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 5: SUBJECT PERFORMANCE RANKING
   All widths use "*" for variable-length text — never overflows
   ═══════════════════════════════════════════════════════════════════ */

function layoutSubjectPerformance(analysis) {
  const { subjectStats } = analysis;
  const auditContent = [];

  const primaryGridWidths = [42, "*", 26, 50, 48, 48, 52, 58, "*"];
  const baselineHeader = [
    buildGridHeader("CODE"),
    buildGridHeader("SUBJECT TITLE", "left"),
    buildGridHeader("COEF"),
    buildGridHeader("AVG SCORE"),
    buildGridHeader("HIGHEST"),
    buildGridHeader("LOWEST"),
    buildGridHeader("PASS RATE"),
    buildGridHeader("PASS/FAIL"),
    buildGridHeader("TEACHER NAME", "left"),
  ];

  const mainStatsRows = subjectStats.map((s, idx) => {
    const rowTint = idx % 2 === 0 ? null : C.rowAlt;
    return [
      buildGridCell(s.code, "center", true, C.navy, rowTint),
      buildGridCell(s.title, "left", false, C.slate, rowTint),
      buildGridCell(s.coef, "center", false, C.slate, rowTint),
      buildGridCell(
        fmtAvg(s.classAvg),
        "center",
        true,
        getAvgColor(s.classAvg),
        rowTint
      ),
      buildGridCell(fmtAvg(s.highest), "center", false, C.passGreen, rowTint),
      buildGridCell(
        fmtAvg(s.lowest),
        "center",
        false,
        s.lowest != null && s.lowest < 10 ? C.failRed : C.slate,
        rowTint
      ),
      buildGridCell(
        fmtPct(s.passRate),
        "center",
        true,
        getPctColor(s.passRate),
        rowTint
      ),
      buildGridCell(
        `${s.passed}/${s.failed}`,
        "center",
        false,
        C.slate,
        rowTint
      ),
      buildGridCell(s.teacher || "Unassigned", "left", false, C.slate, rowTint),
    ];
  });

  auditContent.push(
    makeChapterHeader(
      "CHAPTER 5: SUBJECT PERFORMANCE RANKING (BEST TO WORST)",
      "chap5"
    ),
    {
      text: "SUBJECT PERFORMANCE MATRIX (RANKED HIGHEST TO LOWEST)",
      fontSize: 8.5,
      bold: true,
      color: C.navy,
      margin: [0, 2, 0, 4],
    },
    {
      table: {
        dontBreakRows: false,
        headerRows: 1,
        widths: primaryGridWidths,
        body: [baselineHeader, ...mainStatsRows],
      },
      layout: getTableLayoutSpec(),
      margin: [0, 0, 0, 15],
    },
    {
      text: "BEST STUDENTS & STUDENTS WHO NEED HELP PER SUBJECT",
      fontSize: 8.5,
      bold: true,
      color: C.navy,
      margin: [0, 5, 0, 4],
    }
  );

  // Per-subject top/bottom — stacked vertically, widths: 45 + * + * — always fits
  for (const s of subjectStats) {
    const renderTop3 =
      s.top3
        .map((st, i) => `${i + 1}. ${st.name} (${fmtAvg(st.score)})`)
        .join("\n") || "No data";
    const renderBottom3 =
      s.bottom3
        .map((st, i) => `${i + 1}. ${st.name} (${fmtAvg(st.score)})`)
        .join("\n") || "No data";

    auditContent.push({
      table: {
        dontBreakRows: true,
        widths: [45, "*", "*"],
        body: [
          [
            {
              text: s.code,
              bold: true,
              fontSize: 8,
              alignment: "center",
              color: C.navy,
              fillColor: C.bgHeader,
              rowSpan: 2,
              margin: [0, 4, 0, 4],
            },
            {
              text: "BEST THREE STUDENTS",
              fontSize: 7,
              bold: true,
              color: C.excellent,
              fillColor: C.bgHeader,
            },
            {
              text: "THREE STUDENTS WHO NEED HELP",
              fontSize: 7,
              bold: true,
              color: C.weak,
              fillColor: C.bgHeader,
            },
          ],
          [
            "",
            {
              text: renderTop3,
              fontSize: 7,
              color: C.slate,
              margin: [2, 3, 2, 3],
              lineHeight: 1.2,
            },
            {
              text: renderBottom3,
              fontSize: 7,
              color: C.slate,
              margin: [2, 3, 2, 3],
              lineHeight: 1.2,
            },
          ],
        ],
      },
      layout: getTableLayoutSpec(),
      margin: [0, 0, 0, 5],
    });
  }

  return auditContent;
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 6: GRADE DISTRIBUTION
   FIX: NEVER side-by-side. Both tables ALWAYS stacked vertically.
        Per-subject tally chunked to max 8 subjects per table.
   ═══════════════════════════════════════════════════════════════════ */

function layoutGradeDistribution(analysis) {
  const { distribution, allSubjects, overallStats: os } = analysis;
  const grandTotal = os.totalStudents;
  const elements = [];

  elements.push(
    makeChapterHeader("CHAPTER 6: GRADE DISTRIBUTION AND ANALYSIS", "chap6")
  );

  // ──────── TABLE 1: General Grade Summary (always fits — 4 cols) ────────
  elements.push({
    text: "GENERAL GRADE SUMMARY",
    fontSize: 8.5,
    bold: true,
    color: C.navy,
    margin: [0, 0, 0, 4],
  });

  const summaryBody = [
    [
      buildGridHeader("REMARK", "left"),
      buildGridHeader("MARK RANGE"),
      buildGridHeader("STUDENT COUNT"),
      buildGridHeader("PERCENTAGE"),
    ],
    ...distribution.map((d) => {
      const sharePct =
        grandTotal > 0 ? roundNum((d.count / grandTotal) * 100) : 0;
      return [
        buildGridCell(d.label, "left", true, getRemarkColor(d.label)),
        buildGridCell(
          `${Number(d.min).toFixed(1)} – ${Number(d.max).toFixed(1)}`
        ),
        buildGridCell(d.count, "center", true),
        buildGridCell(fmtPct(sharePct), "center", true, getPctColor(sharePct)),
      ];
    }),
  ];

  elements.push({
    table: {
      dontBreakRows: true,
      headerRows: 1,
      widths: ["*", 100, 80, 80],
      body: summaryBody,
    },
    layout: getTableLayoutSpec({ zebra: true }),
    margin: [0, 0, 0, 18],
  });

  // ──────── TABLE 2: Grade Tally Per Subject — chunked to max 8 rows ────────
  elements.push({
    text: "GRADE TALLY PER SUBJECT",
    fontSize: 8.5,
    bold: true,
    color: C.navy,
    margin: [0, 0, 0, 4],
  });

  // Subjects as ROWS, grades as COLUMNS — but chunk subjects to max 8 per table
  const subjectChunks = chunkArray(allSubjects, MAX_SUBJECTS_PER_PAGE);

  subjectChunks.forEach((chunk, chunkIdx) => {
    if (chunkIdx > 0) {
      elements.push({
        text: `GRADE TALLY PER SUBJECT (CONTINUED — PART ${chunkIdx + 1} OF ${
          subjectChunks.length
        })`,
        fontSize: 7.5,
        bold: true,
        color: C.navy,
        margin: [0, 12, 0, 4],
      });
    }

    const tallyHeader = [
      buildGridHeader("SUBJECT", "left", 7),
      ...distribution.map((d) => buildGridHeader(d.label, "center", 7)),
    ];

    const tallyRows = chunk.map((s, idx) => {
      const bg = idx % 2 === 0 ? null : C.rowAlt;
      return [
        buildGridCell(s.code, "left", true, C.navy, bg),
        ...distribution.map((d) => {
          const tally = d.perSubject[s.code] || 0;
          return buildGridCell(
            tally > 0 ? tally : "-",
            "center",
            tally > 0,
            tally > 0 ? C.slate : C.rowAlt,
            bg
          );
        }),
      ];
    });

    // Widths: SUBJECT(70) + grade cols (all "*") — pdfmake auto-distributes
    elements.push({
      table: {
        dontBreakRows: true,
        headerRows: 1,
        widths: [70, ...distribution.map(() => "*")],
        body: [tallyHeader, ...tallyRows],
      },
      layout: getTableLayoutSpec(),
      margin: [0, 0, 0, 10],
    });
  });

  return elements;
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 7: BEST STUDENTS & STUDENTS WHO NEED HELP
   All tables stacked vertically. All widths use "*" for flexibility.
   ═══════════════════════════════════════════════════════════════════ */

function layoutPerformanceExtremes(analysis) {
  const dynamicStack = [];

  const eliteRosterRows = analysis.subjectStats
    .filter((s) => s.highest != null)
    .map((s) => {
      const champMatch = s.top3[0]?.name || "N/A";
      return [
        buildGridCell(s.code, "center", true, C.navy),
        buildGridCell(s.title, "left"),
        buildGridCell(champMatch, "left", true, C.navy),
        buildGridCell(fmtAvg(s.highest), "center", true, C.passGreen),
      ];
    });

  if (eliteRosterRows.length) {
    dynamicStack.push(
      {
        text: "BEST STUDENTS PER SUBJECT",
        fontSize: 8.5,
        bold: true,
        color: C.passGreen,
        margin: [0, 0, 0, 4],
      },
      {
        table: {
          dontBreakRows: false,
          headerRows: 1,
          widths: [50, "*", "*", 65],
          body: [
            [
              buildGridHeader("CODE"),
              buildGridHeader("SUBJECT TITLE", "left"),
              buildGridHeader("STUDENT NAME", "left"),
              buildGridHeader("HIGHEST"),
            ],
            ...eliteRosterRows,
          ],
        },
        layout: getTableLayoutSpec({ zebra: true }),
        margin: [0, 0, 0, 15],
      }
    );
  }

  const { failingStudents } = analysis;
  if (failingStudents.length) {
    dynamicStack.push({
      text: `STUDENTS WHO NEED HELP TO PASS (${failingStudents.length} Student${
        failingStudents.length > 1 ? "s" : ""
      } with Average under 10/20)`,
      fontSize: 8.5,
      bold: true,
      color: C.failRed,
      margin: [0, 2, 0, 4],
    });

    const dangerRows = failingStudents.map((st) => {
      const compositeDeficiencies = st.deficiencies
        .map((d) => `${d.code}(${fmtAvg(d.score)})`)
        .join(", ");
      return [
        buildGridCell(st.rank, "center", true),
        buildGridCell(st.name, "left", true, C.navy),
        buildGridCell(fmtAvg(st.average), "center", true, C.failRed),
        buildGridCell(st.totalFailed, "center", true, C.failRed),
        {
          text: compositeDeficiencies || "None",
          fontSize: 7,
          color: C.failRed,
          alignment: "left",
        },
      ];
    });

    dynamicStack.push({
      table: {
        dontBreakRows: false,
        headerRows: 1,
        widths: [25, "*", 55, 50, "*"],
        body: [
          [
            buildGridHeader("Rank"),
            buildGridHeader("STUDENT NAME", "left"),
            buildGridHeader("TERM AVG"),
            buildGridHeader("FAILED\nSUBJECTS"),
            buildGridHeader("SUBJECTS FAILED AND MARKS", "left"),
          ],
          ...dangerRows,
        ],
      },
      layout: getTableLayoutSpec({ zebra: true }),
      margin: [0, 0, 0, 15],
    });
  } else {
    dynamicStack.push({
      text: "PERFORMANCE SUCCESS: All students cleared the minimum 10/20 standard.",
      fontSize: 9,
      bold: true,
      color: C.passGreen,
      margin: [0, 15, 0, 15],
    });
  }

  if (analysis.termInfo.totalKey === "annual") {
    dynamicStack.push({ text: "", pageBreak: "before" });
    dynamicStack.push({
      text: "ANNUAL REPEATERS: PROPOSED CLASS REPETITION",
      fontSize: 10,
      bold: true,
      color: C.failRed,
      margin: [0, 0, 0, 5],
    });

    if (failingStudents.length) {
      const repeatersRow = failingStudents.map((st) => [
        buildGridCell(st.rank, "center", true),
        buildGridCell(st.name, "left", true, C.navy),
        buildGridCell(fmtAvg(st.average), "center", true, C.failRed),
      ]);
      dynamicStack.push({
        table: {
          dontBreakRows: false,
          headerRows: 1,
          widths: [30, "*", 100],
          body: [
            [
              buildGridHeader("Rank"),
              buildGridHeader("STUDENT NAME", "left"),
              buildGridHeader("ANNUAL AVERAGE"),
            ],
            ...repeatersRow,
          ],
        },
        layout: getTableLayoutSpec({ zebra: true }),
        margin: [0, 0, 0, 10],
      });
    } else {
      dynamicStack.push({
        text: "100% PROMOTION RATE: No student has an annual average below 10/20.",
        fontSize: 9,
        bold: true,
        color: C.passGreen,
        margin: [0, 5, 0, 10],
      });
    }
  }

  return [
    makeChapterHeader(
      "CHAPTER 7: BEST STUDENTS AND STUDENTS WHO NEED HELP",
      "chap7"
    ),
    ...dynamicStack,
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   CHAPTER 8: SIGNATURES — stacked vertically
   ═══════════════════════════════════════════════════════════════════ */

function layoutSignaturesMatrix(meta) {
  const clearanceBlock = (roleTitle, officialName) => ({
    stack: [
      {
        text: roleTitle.toUpperCase(),
        fontSize: 9,
        bold: true,
        color: C.navy,
        alignment: "center",
        margin: [0, 0, 0, 4],
      },
      {
        text: "SIGNED AND CERTIFIED OFFICIAL",
        fontSize: 6.5,
        italics: true,
        color: C.slate,
        alignment: "center",
        margin: [0, 0, 0, 40],
      },
      {
        canvas: [
          {
            type: "line",
            x1: 10,
            y1: 0,
            x2: 200,
            y2: 0,
            lineWidth: 1.2,
            lineColor: C.navy,
          },
        ],
        margin: [0, 0, 0, 4],
      },
      {
        text: String(officialName || "").toUpperCase(),
        fontSize: 9.5,
        bold: true,
        color: C.slate,
        alignment: "center",
      },
      {
        text: "Authorized School Signature Seal",
        fontSize: 6,
        italics: true,
        color: C.slate,
        alignment: "center",
      },
    ],
  });

  const verificationStampBox = {
    stack: [
      {
        text: "SCHOOL STAMP BOX",
        fontSize: 7,
        bold: true,
        color: C.gold,
        alignment: "center",
        margin: [0, 2, 0, 10],
      },
      {
        table: {
          widths: [110],
          body: [
            [{ text: "", minHeight: 55, border: [true, true, true, true] }],
          ],
        },
        layout: {
          hLineColor: () => C.gold,
          vLineColor: () => C.gold,
          hLineWidth: () => 1.2,
          vLineWidth: () => 1.2,
        },
        alignment: "center",
      },
      {
        text: "Affix Official Meeting Stamp Here",
        fontSize: 6,
        italics: true,
        color: C.slate,
        alignment: "center",
        margin: [0, 4, 0, 0],
      },
    ],
  };

  // Signatures side by side is safe — 3 cols with small fixed center
  return [
    makeChapterHeader(
      "CHAPTER 8: OFFICIAL SIGNATURES AND STAMP VALIDATION",
      "chap8"
    ),
    { text: "", margin: [0, 15, 0, 0] },
    {
      columns: [
        {
          width: "*",
          ...clearanceBlock("Class Master Instructor", meta.classMaster),
        },
        { width: 140, ...verificationStampBox },
        { width: "*", ...clearanceBlock("School Principal", meta.principal) },
      ],
      columnGap: 20,
      margin: [10, 0, 10, 20],
    },
    {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: 792,
          y2: 0,
          lineWidth: 0.5,
          lineColor: C.gold,
        },
      ],
      margin: [0, 25, 0, 10],
    },
    {
      text: "DOCUMENT CONTROL ID: VOTECH-S7-OFFICIAL-MEETING-REPORT-LEDGER | SECURE ADMINISTRATIVE TECH MATRIX",
      fontSize: 6,
      color: C.slate,
      alignment: "center",
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   9. BOOKLET COMPILER
   ═══════════════════════════════════════════════════════════════════ */

function buildMasterSheetDoc(meta, analysis, gradingScale, logoBase64) {
  const content = [];

  content.push(...layoutCoverPage(meta, analysis, logoBase64));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutExecutiveSummary(analysis));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutMarksOverview(analysis, gradingScale));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutDetailedSequences(analysis));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutSubjectPerformance(analysis));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutGradeDistribution(analysis));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutPerformanceExtremes(analysis));
  content.push({ text: "", pageBreak: "before" });
  content.push(...layoutSignaturesMatrix(meta));

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [25, 25, 25, 30],
    content,
    defaultStyle: { font: "Roboto", fontSize: 7.5, lineHeight: 1.2 },
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: `School Marks Record | Class: ${meta.className} | ${analysis.termInfo.label} (${meta.academicYear})`,
          fontSize: 6.5,
          color: C.slate,
          margin: [25, 0, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 6.5,
          bold: true,
          color: C.navy,
          alignment: "right",
          margin: [0, 0, 25, 0],
        },
      ],
    }),
    ...(logoBase64 ? { images: { reportLogo: logoBase64 } } : {}),

    ...(logoBase64
      ? {
          background: (currPage, size) => ({
            image: "reportLogo",
            width: 340,
            height: 340,
            opacity: 0.02,
            absolutePosition: {
              x: (size.width - 340) / 2,
              y: (size.height - 340) / 2,
            },
          }),
        }
      : {}),
    info: {
      title: `Academic_Report_Booklet_${meta.className}_${analysis.termInfo.label}`,
      author: "School Administration Tech Engine",
      subject: "Official Academic Master Sheet Report",
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   10. CONTROLLER ROUTER
   ═══════════════════════════════════════════════════════════════════ */

const sanitize = (str = "") => String(str).replace(/[^\w]+/g, "_");

// Shared by both the PDF endpoint and the JSON "view" endpoint, so the
// admin-facing screen and the downloaded PDF are always built from the
// exact same computed analysis — only the presentation differs.
async function getMasterSheetData({ academicYearId, departmentId, classId, term = "term3" }) {
  if (!academicYearId || !departmentId || !classId) {
    const err = new AppError(
      "Required arguments missing: academicYearId, departmentId, classId",
      StatusCodes.BAD_REQUEST
    );
    throw err;
  }

  const [academicYear, department, studentClass] = await Promise.all([
    models.AcademicYear.findByPk(academicYearId),
    models.Specialty.findByPk(departmentId),
    models.Class.findByPk(classId, {
      include: [
        {
          model: models.User,
          as: "classMaster",
          attributes: ["name", "username"],
        },
      ],
    }),
  ]);

  if (!academicYear) throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
  if (!department) throw new AppError("Department not found", StatusCodes.NOT_FOUND);
  if (!studentClass) throw new AppError("Class not found", StatusCodes.NOT_FOUND);

  const marks = await fetchMarksWithIncludes(academicYearId, classId);
  if (!marks.length) {
    throw new AppError(
      `No marks recorded for class ${studentClass.name}`,
      StatusCodes.NOT_FOUND
    );
  }

  const classMaster =
    studentClass?.classMaster?.name || studentClass?.classMaster?.username || "";
  const termKey = await resolveTermKey(term, academicYearId);
  const cards = buildReportCardsFromMarks(marks, classMaster, termKey);

  const rawBands = await models.AcademicBand.findAll({
    where: { academic_year_id: academicYear.id, class_id: studentClass.id },
    raw: true,
  });
  const gradingScale = prepareGrading(rawBands);
  const analysis = analyzeMasterSheet(cards, termKey, gradingScale);

  const meta = {
    schoolName: "Votech S7 Academy",
    className: studentClass.name,
    departmentName: department.name,
    academicYear: academicYear.name,
    classMaster,
    principal: "Mr. Thomas Ambe",
  };

  return { meta, analysis, gradingScale };
}

// ── JSON data endpoint — powers the in-app navigable master sheet view
// (subject switcher, stats, student table). Never renders a PDF, so it's
// cheap regardless of class size — the same analysis object the PDF path
// computes, just serialized instead of laid out.
const classMasterSheetData = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId, term = "term3" } = req.query;
  try {
    const { meta, analysis, gradingScale } = await getMasterSheetData({
      academicYearId,
      departmentId,
      classId,
      term,
    });
    appResponder(StatusCodes.OK, { meta, analysis, gradingScale }, res);
  } catch (err) {
    return next(err);
  }
});

const classMasterSheet = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId, term = "term3", disposition = "attachment" } =
    req.query;

  let meta, analysis, gradingScale;
  try {
    ({ meta, analysis, gradingScale } = await getMasterSheetData({
      academicYearId,
      departmentId,
      classId,
      term,
    }));
  } catch (err) {
    return next(err);
  }

  const logoBase64 = loadLogoBase64();
  const docDefinition = buildMasterSheetDoc(
    meta,
    analysis,
    gradingScale,
    logoBase64
  );

  const explicitFilename = `Official_Report_Booklet_${sanitize(
    meta.academicYear
  )}_${sanitize(meta.departmentName)}_${sanitize(meta.className)}_${sanitize(
    analysis.termInfo.label
  )}.pdf`;

  const safeDisposition = disposition === "inline" ? "inline" : "attachment";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${safeDisposition}; filename="${explicitFilename}"`
  );

  try {
    await streamPdfToResponse(docDefinition, res);
  } catch (err) {
    console.error("Critical error building report booklet:", err);
    if (!res.headersSent) {
      return next(
        new AppError(
          "Document compilation failed: " + (err.message || ""),
          StatusCodes.INTERNAL_SERVER_ERROR
        )
      );
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════
   11. DATA LAYER
   ═══════════════════════════════════════════════════════════════════ */

async function resolveTermKey(rawTerm, academicYearId) {
  const normalized = String(rawTerm ?? "term3")
    .toLowerCase()
    .trim();
  if (
    normalized === "term1" ||
    normalized === "t1" ||
    normalized.includes("first")
  )
    return "term1";
  if (
    normalized === "term2" ||
    normalized === "t2" ||
    normalized.includes("second")
  )
    return "term2";
  if (
    normalized === "term3" ||
    normalized === "t3" ||
    normalized.includes("third")
  )
    return "term3";
  if (normalized === "annual" || normalized === "all") return "annual";

  const parsedNum = Number(normalized);
  if (!Number.isNaN(parsedNum)) {
    if ([1, 2, 3].includes(parsedNum)) return `term${parsedNum}`;
    const row = await models.Term.findOne({
      where: { id: parsedNum, academic_year_id: academicYearId },
      attributes: ["order_number"],
    });
    if (row && [1, 2, 3].includes(Number(row.order_number)))
      return `term${row.order_number}`;
  }
  return "term3";
}

async function fetchMarksWithIncludes(academicYearId, classId) {
  return models.Mark.findAll({
    where: { academic_year_id: academicYearId, class_id: classId },
    include: [
      {
        model: models.Student,
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
                model: models.Specialty,
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
            // Same fan-out bug found and fixed in reportCardPdfGenerator.js's
            // copy of this query: without this, every Mark row joins
            // against every class's teacher-assignment row for that
            // subject school-wide, not just this class's, a measured
            // 20x row multiplication at scale.
            where: { class_id: classId },
            required: false,
            attributes: ["id", "class_id"],
            include: [
              {
                model: models.User,
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
      [{ model: models.Student, as: "student" }, "full_name", "ASC"],
      [{ model: models.Subject, as: "subject" }, "code", "ASC"],
      [{ model: models.Term, as: "term" }, "order_number", "ASC"],
      [{ model: models.Sequence, as: "sequence" }, "order_number", "ASC"],
    ],
  });
}

function streamPdfToResponse(docDefinition, res) {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      doc.on("error", reject);
      doc.on("end", resolve);
      doc.pipe(res);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  classMasterSheet,
  classMasterSheetData,
  analyzeMasterSheet,
  buildMasterSheetDoc,
};
