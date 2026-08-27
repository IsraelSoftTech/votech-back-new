"use strict";

// Transcript: a single student's full academic history across every year
// they attended, one chapter per (academic_year, class) they were ever in
// — including a year still in progress (the mid-year-transfer case: the
// student never finished it, so there's no StudentPromotion row for it
// yet, only whatever marks exist so far). Reuses the exact same
// computation engine and PDF layout as a normal report card — a
// transcript chapter IS a normal annual report card page, just for a year
// that isn't the active one, stacked with every other year the student
// ever had. Nothing here recomputes marks or teacher/class-master
// attribution independently; it all flows through the same year-scoped
// tables (class_subjects, class_master_assignments) a normal report card
// already reads, so a transcript can never disagree with a report card
// printed for the same year.

const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const appResponder = require("../utils/appResponder");
const { resolveClassMasterName } = require("../utils/classMaster.util");
const { getOrCreateSettings } = require("./schoolSettings.controller");
const {
  buildReportCardsFromMarks,
  attachAcademicRemarks,
} = require("./reportCard.controller");
const {
  fetchMarksWithIncludes,
  prepareGrading,
  loadLogoBase64,
  generatePdfBuffer,
  sanitize,
} = require("./reportCardPdfGenerator");

const C = {
  primary: "#204080",
  gold: "#c9a96e",
  dark: "#333333",
  light: "#666666",
  cardBg: "#f8f9ff",
  excellent: "#0d5f0d",
  vgood: "#1a5f1a",
  good: "#204080",
  fairlyGood: "#b8860b",
  average: "#ff8c00",
  weak: "#cc0000",
};

function fmtScore(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toFixed(1);
}

// Colors a score by the SAME grading scale a report card for that year
// would use (AcademicBand rows for that class/year, already resolved
// into section.gradingScale via prepareGrading — falls back to that
// function's own built-in default when no custom bands exist for the
// class). Never a hardcoded scale of its own, so a school that
// configures custom bands sees that reflected here too, not just on
// report cards.
function getRemark(avg, gradingScale) {
  if (avg == null || Number.isNaN(Number(avg))) return "N/A";
  const band = (gradingScale || []).find((g) => avg >= g.band_min && avg <= g.band_max);
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

function colorForAverage(avg, gradingScale) {
  return remarkColor(getRemark(avg, gradingScale));
}

function toneColor(tone) {
  if (tone === "good") return C.excellent;
  if (tone === "warn") return C.fairlyGood;
  if (tone === "bad") return C.weak;
  return C.dark;
}

// ─── Which (year, class) sections make up this student's history ───────
//
// Every StudentPromotion row's from_* pair is one completed year. Union
// that with the student's CURRENT position (Student.class_id/
// academic_year_id) when it isn't already covered — that's either a year
// still in progress, or (for a withdrawn/mid-year-transfer student) their
// last partial year. Explicitly excluded for a graduated student: on
// graduation the promotion engine sets class_id to null and
// academic_year_id to the year they graduated INTO (never attended), see
// promotion.controller.js's processMove — that combination is never a
// real section, it would just be noise.
async function buildTranscriptSections(student) {
  const promotions = await models.StudentPromotion.findAll({
    where: { student_id: student.id },
    include: [
      { association: models.StudentPromotion.associations.from_class },
      { association: models.StudentPromotion.associations.from_academic_year },
    ],
  });

  const sections = [];
  const seenYearIds = new Set();

  for (const p of promotions) {
    if (!p.from_academic_year_id || seenYearIds.has(p.from_academic_year_id)) {
      continue;
    }
    seenYearIds.add(p.from_academic_year_id);
    sections.push({
      academic_year_id: p.from_academic_year_id,
      academic_year_name: p.from_academic_year?.name || null,
      start_date: p.from_academic_year?.start_date || null,
      class_id: p.from_class_id,
      class_name: p.from_class?.name || null,
      in_progress: false,
    });
  }

  if (
    student.status !== "graduated" &&
    student.class_id &&
    student.academic_year_id &&
    !seenYearIds.has(student.academic_year_id)
  ) {
    const [cls, year] = await Promise.all([
      models.Class.findByPk(student.class_id, { attributes: ["id", "name"] }),
      models.AcademicYear.findByPk(student.academic_year_id, {
        attributes: ["id", "name", "start_date"],
      }),
    ]);
    sections.push({
      academic_year_id: student.academic_year_id,
      academic_year_name: year?.name || null,
      start_date: year?.start_date || null,
      class_id: student.class_id,
      class_name: cls?.name || null,
      in_progress: true,
    });
  }

  sections.sort((a, b) => new Date(a.start_date || 0) - new Date(b.start_date || 0));
  return sections;
}

// ─── One section's worth of computed report-card data ──────────────────
//
// Deliberately reruns the same whole-class query + builder a normal
// report card uses (fetchMarksWithIncludes + buildReportCardsFromMarks)
// rather than a student-only shortcut — that's what gives a section its
// correct class rank/class-average context, and guarantees a transcript
// chapter can never drift from what printing that year's report card
// directly would show. termKey "term3" is used purely for its column
// layout (T1/T2/T3/Final), not as a claim the year is complete —
// computeTerm/annualTermAverages already skip any term with no marks, so
// a 2-sequence partial year renders with only Term 1 populated and an
// annual average based on just that, nothing crashes or fakes zeros.
async function buildSectionCard(studentId, section, settings) {
  const marks = await fetchMarksWithIncludes(section.academic_year_id, section.class_id);
  if (!marks.length) return null;

  const classMaster = await resolveClassMasterName(section.class_id, section.academic_year_id);
  const cards = buildReportCardsFromMarks(
    marks,
    classMaster,
    "term3",
    settings.principal_name,
    settings
  );
  const card = cards.find((c) => String(c.student.id) === String(studentId));
  if (!card) return null;

  await attachAcademicRemarks([card], section.academic_year_id, section.class_id, "term3");

  const [gradingRaw, studentClass] = await Promise.all([
    models.AcademicBand.findAll({
      where: { academic_year_id: section.academic_year_id, class_id: section.class_id },
      raw: true,
    }),
    models.Class.findByPk(section.class_id, { attributes: ["is_orientation"] }),
  ]);

  return {
    card,
    gradingScale: prepareGrading(gradingRaw),
    isOrientationClass: !!studentClass?.is_orientation,
  };
}

async function loadStudentAndSections(studentId) {
  const student = await models.Student.findByPk(studentId, {
    attributes: ["id", "full_name", "student_id", "date_of_birth", "status", "class_id", "academic_year_id"],
  });
  if (!student) return { student: null, sections: [] };
  const sections = await buildTranscriptSections(student);
  return { student, sections };
}

// ─── JSON preview — lets the frontend show what a transcript would
// contain (which years, whether each has marks) before generating the
// PDF. Any student, any status — a transfer with a single partial year
// still gets a one-section transcript rather than an error. ──────────────

const getTranscript = catchAsync(async (req, res, next) => {
  const { student, sections } = await loadStudentAndSections(req.params.id);
  if (!student) {
    return next(new AppError("Student not found", StatusCodes.NOT_FOUND));
  }

  const settings = await getOrCreateSettings();

  const built = [];
  for (const section of sections) {
    const result = await buildSectionCard(student.id, section, settings);
    built.push({
      academic_year_id: section.academic_year_id,
      academic_year_name: section.academic_year_name,
      class_id: section.class_id,
      class_name: section.class_name,
      in_progress: section.in_progress,
      has_marks: !!result,
      annual_average: result?.card?.termTotals?.annual?.average ?? null,
      academic_remark: result?.card?.academicRemark || null,
    });
  }

  appResponder(
    StatusCodes.OK,
    {
      student: {
        id: student.id,
        name: student.full_name,
        registrationNumber: student.student_id,
        dateOfBirth: student.date_of_birth,
        status: student.status,
      },
      school: {
        name: settings.school_name,
        address: settings.address,
        principal: settings.principal_name,
        motto: settings.motto,
      },
      sections: built,
    },
    res
  );
});

// ─── Per-year academic detail ────────────────────────────────────────
//
// Every sequence score, every term average, the final average — the full
// working, not the abbreviated single-term view a normal report card
// shows. headerRows: 1 tells pdfmake to repeat the header row on its own
// if this table runs past one page (a student with a long subject list),
// so nothing gets silently clipped — pdfmake breaks tables across pages
// natively as long as they aren't wrapped in `unbreakable`, which this
// deliberately isn't.

const SUBJECT_TABLE_WIDTHS = ["*", 22, 24, 24, 28, 24, 24, 28, 24, 24, 28, 32, 80];
const SUBJECT_TABLE_HEADERS = [
  "SUBJECT", "COEF", "SEQ1", "SEQ2", "TERM 1", "SEQ3", "SEQ4", "TERM 2",
  "SEQ5", "SEQ6", "TERM 3", "FINAL", "TEACHER",
];

function hdrCell(text) {
  return {
    text,
    bold: true,
    fontSize: 6.5,
    color: "#fff",
    fillColor: C.primary,
    alignment: "center",
    margin: [0, 3, 0, 3],
  };
}

function buildSubjectTable(title, subjects, gradingScale) {
  if (!subjects || !subjects.length) return [];

  const body = [SUBJECT_TABLE_HEADERS.map(hdrCell)];
  subjects.forEach((s, i) => {
    const zebra = i % 2 === 1 ? C.cardBg : "#ffffff";
    const cell = (text, extra = {}) => ({
      text,
      fontSize: 6.5,
      alignment: "center",
      fillColor: zebra,
      ...extra,
    });
    body.push([
      { text: s.title || "", fontSize: 6.5, fillColor: zebra },
      cell(String(s.coef ?? "-")),
      cell(fmtScore(s.scores?.seq1)),
      cell(fmtScore(s.scores?.seq2)),
      cell(fmtScore(s.scores?.term1Avg), { bold: true }),
      cell(fmtScore(s.scores?.seq3)),
      cell(fmtScore(s.scores?.seq4)),
      cell(fmtScore(s.scores?.term2Avg), { bold: true }),
      cell(fmtScore(s.scores?.seq5)),
      cell(fmtScore(s.scores?.seq6)),
      cell(fmtScore(s.scores?.term3Avg), { bold: true }),
      cell(fmtScore(s.scores?.finalAvg), {
        bold: true,
        fontSize: 7,
        color: colorForAverage(s.scores?.finalAvg, gradingScale),
      }),
      { text: s.teacher || "-", fontSize: 6, fillColor: zebra },
    ]);
  });

  return [
    { text: title, fontSize: 8, bold: true, color: C.primary, margin: [0, 8, 0, 3] },
    {
      table: { headerRows: 1, widths: SUBJECT_TABLE_WIDTHS, body },
      layout: {
        hLineWidth: (i) => (i <= 1 ? 1 : 0.5),
        vLineWidth: () => 0.3,
        hLineColor: () => "#cccccc",
        vLineColor: () => "#dddddd",
        paddingTop: () => 2,
        paddingBottom: () => 2,
        paddingLeft: () => 3,
        paddingRight: () => 3,
      },
    },
  ];
}

function buildYearHeader(section, card) {
  return {
    columns: [
      {
        width: "*",
        stack: [
          {
            text: `ACADEMIC YEAR: ${section.academic_year_name || ""}${
              section.in_progress ? "  (IN PROGRESS)" : ""
            }`,
            fontSize: 12,
            bold: true,
            color: C.primary,
          },
          {
            text: `Class: ${section.class_name || "-"}     Class Master: ${
              card.administration?.classMaster || "-"
            }`,
            fontSize: 8,
            color: C.dark,
            margin: [0, 3, 0, 0],
          },
        ],
      },
      {
        width: "auto",
        stack: [
          {
            text: card.academicRemark?.text || "",
            fontSize: 10,
            bold: true,
            alignment: "right",
            color: toneColor(card.academicRemark?.tone),
          },
        ],
      },
    ],
    margin: [0, 0, 0, 8],
  };
}

function buildYearSummary(card) {
  const tt = card.termTotals || {};
  const cs = card.classStatistics || {};
  const cell = (label, value, big = false) => ({
    stack: [
      { text: label, fontSize: 6, color: C.light, alignment: "center" },
      { text: value, fontSize: big ? 12 : 9, bold: true, color: C.primary, alignment: "center" },
    ],
  });
  return {
    unbreakable: true,
    columns: [
      cell("TERM 1 AVERAGE", fmtScore(tt.term1?.average)),
      cell("TERM 2 AVERAGE", fmtScore(tt.term2?.average)),
      cell("TERM 3 AVERAGE", fmtScore(tt.term3?.average)),
      cell("ANNUAL AVERAGE", fmtScore(tt.annual?.average), true),
      cell(
        "CLASS RANK",
        tt.annual?.rank ? `${tt.annual.rank} / ${tt.annual.outOf}` : "-"
      ),
      cell("CLASS AVERAGE", fmtScore(cs.classAverage)),
      cell("HIGHEST IN CLASS", fmtScore(cs.highestAverage)),
      cell("LOWEST IN CLASS", fmtScore(cs.lowestAverage)),
    ],
    columnGap: 10,
    margin: [0, 12, 0, 0],
  };
}

function buildYearSection(section, card, gradingScale) {
  return [
    buildYearHeader(section, card),
    ...buildSubjectTable("GENERAL SUBJECTS", card.generalSubjects, gradingScale),
    ...buildSubjectTable("PROFESSIONAL SUBJECTS", card.professionalSubjects, gradingScale),
    ...buildSubjectTable("PRACTICAL SUBJECTS", card.practicalSubjects, gradingScale),
    buildYearSummary(card),
  ];
}

// ─── Cover page ──────────────────────────────────────────────────────

const PROMOTION_DECISION_LABELS = {
  promoted: "Promoted",
  promoted_on_condition: "Promoted on Condition",
  failed: "Failed / Repeated",
};

function buildCoverPage(student, settings, sections, logoBase64, promotions) {
  const attendedYears = sections.filter((s) => s.has_marks);
  const yearRange =
    attendedYears.length > 0
      ? `${attendedYears[0].academic_year_name} — ${attendedYears[attendedYears.length - 1].academic_year_name}`
      : "No recorded years";

  const promotionRows = (promotions || [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.from_academic_year?.start_date || 0) -
        new Date(b.from_academic_year?.start_date || 0)
    )
    .map((p) => [
      { text: p.from_academic_year?.name || "-", fontSize: 8 },
      { text: p.from_class?.name || "-", fontSize: 8 },
      {
        text: PROMOTION_DECISION_LABELS[p.decision] || p.decision,
        fontSize: 8,
        bold: true,
      },
      { text: p.overall_average != null ? fmtScore(p.overall_average) : "-", fontSize: 8, alignment: "center" },
      { text: p.to_class?.name || "Graduated", fontSize: 8 },
    ]);

  return [
    {
      stack: [
        ...(logoBase64
          ? [{ image: "reportLogo", width: 70, height: 70, alignment: "center", margin: [0, 20, 0, 8] }]
          : []),
        {
          text: "REPUBLIC OF CAMEROON",
          fontSize: 10,
          bold: true,
          color: C.primary,
          alignment: "center",
        },
        {
          text: "PEACE - WORK - FATHERLAND",
          fontSize: 8,
          italics: true,
          bold: true,
          color: C.gold,
          alignment: "center",
          margin: [0, 1, 0, 10],
        },
        {
          text: (settings.school_name || "VOTECH S7 ACADEMY").toUpperCase(),
          fontSize: 16,
          bold: true,
          color: C.primary,
          alignment: "center",
          characterSpacing: 1,
        },
        {
          text: settings.address || "",
          fontSize: 9,
          color: C.light,
          alignment: "center",
          margin: [0, 2, 0, 0],
        },
        {
          text: settings.motto ? `Motto: ${settings.motto}` : "",
          fontSize: 8,
          italics: true,
          color: C.gold,
          alignment: "center",
          margin: [0, 2, 0, 30],
        },
        {
          text: "TRANSCRIPT OF ACADEMIC RECORDS",
          fontSize: 18,
          bold: true,
          color: C.primary,
          alignment: "center",
          characterSpacing: 1.5,
          margin: [0, 0, 0, 30],
        },
        {
          table: {
            widths: ["40%", "60%"],
            body: [
              [{ text: "Student Name", bold: true, color: C.light, fontSize: 9 }, { text: student.full_name || "", fontSize: 10 }],
              [{ text: "Registration Number", bold: true, color: C.light, fontSize: 9 }, { text: student.student_id || "", fontSize: 10 }],
              [{ text: "Date of Birth", bold: true, color: C.light, fontSize: 9 }, { text: student.date_of_birth || "", fontSize: 10 }],
              [{ text: "Status", bold: true, color: C.light, fontSize: 9 }, { text: (student.status || "").toUpperCase(), fontSize: 10 }],
              [{ text: "Years Covered", bold: true, color: C.light, fontSize: 9 }, { text: yearRange, fontSize: 10 }],
            ],
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0,
            hLineColor: () => "#dddddd",
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
          margin: [40, 0, 40, 30],
        },
        ...(promotionRows.length
          ? [
              {
                text: "PROMOTION HISTORY",
                fontSize: 9,
                bold: true,
                color: C.primary,
                alignment: "center",
                margin: [0, 0, 0, 6],
              },
              {
                table: {
                  widths: ["22%", "20%", "26%", "12%", "20%"],
                  headerRows: 1,
                  body: [
                    [
                      hdrCell("Academic Year"),
                      hdrCell("Class"),
                      hdrCell("Decision"),
                      hdrCell("Average"),
                      hdrCell("Moved To"),
                    ],
                    ...promotionRows,
                  ],
                },
                layout: {
                  hLineWidth: (i) => (i <= 1 ? 1 : 0.5),
                  vLineWidth: () => 0.3,
                  hLineColor: () => "#cccccc",
                  vLineColor: () => "#dddddd",
                  paddingTop: () => 4,
                  paddingBottom: () => 4,
                  paddingLeft: () => 4,
                  paddingRight: () => 4,
                },
                margin: [40, 0, 40, 30],
              },
            ]
          : []),
        {
          text:
            attendedYears.length < sections.length
              ? "Note: one or more years listed below have no marks on record and are omitted from this document."
              : "",
          fontSize: 7.5,
          italics: true,
          color: C.light,
          alignment: "center",
          margin: [20, 0, 20, 30],
        },
        {
          text:
            "This transcript reflects this student's complete academic record at the institution, " +
            "compiled directly from the official marks and staff assignments on file for each year listed, " +
            "including any year attended only partially.",
          fontSize: 8,
          color: C.dark,
          alignment: "center",
          margin: [40, 0, 40, 40],
        },
        {
          columns: [
            { width: "*", text: "" },
            {
              width: 200,
              stack: [
                { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: C.primary }], margin: [0, 0, 0, 3] },
                { text: (settings.principal_name || "").toUpperCase(), fontSize: 8, bold: true, color: C.dark, alignment: "center" },
                { text: "PRINCIPAL", fontSize: 7, italics: true, color: C.light, alignment: "center" },
              ],
            },
            { width: "*", text: "" },
          ],
        },
        {
          text: `Generated on ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}`,
          fontSize: 7,
          color: C.light,
          alignment: "center",
          margin: [0, 20, 0, 0],
        },
      ],
    },
  ];
}

// ─── PDF ──────────────────────────────────────────────────────────────

const getTranscriptPdf = catchAsync(async (req, res, next) => {
  const { student, sections } = await loadStudentAndSections(req.params.id);
  if (!student) {
    return next(new AppError("Student not found", StatusCodes.NOT_FOUND));
  }
  if (!sections.length) {
    return next(
      new AppError(
        "This student has no recorded class/year history to build a transcript from.",
        StatusCodes.NOT_FOUND
      )
    );
  }

  const settings = await getOrCreateSettings();
  const logoBase64 = loadLogoBase64();

  const [builtSectionsRaw, promotions] = await Promise.all([
    Promise.all(
      sections.map(async (section) => {
        const result = await buildSectionCard(student.id, section, settings);
        return result ? { ...section, ...result } : null;
      })
    ),
    models.StudentPromotion.findAll({
      where: { student_id: student.id },
      include: [
        { association: models.StudentPromotion.associations.from_class },
        { association: models.StudentPromotion.associations.from_academic_year },
        { association: models.StudentPromotion.associations.to_class },
      ],
    }),
  ]);
  const builtSections = builtSectionsRaw.filter(Boolean);

  if (!builtSections.length) {
    return next(
      new AppError(
        "None of this student's recorded years have any marks on file.",
        StatusCodes.NOT_FOUND
      )
    );
  }

  // sections (the raw list) never carries has_marks — that's only ever
  // attached to the separate list getTranscript (the JSON preview)
  // builds. Annotate it here from builtSections (the ones that actually
  // resolved to real data) so the cover page's "Years Covered" line
  // reflects reality instead of always reading empty.
  const builtYearIds = new Set(builtSections.map((s) => s.academic_year_id));
  const sectionsWithHasMarks = sections.map((s) => ({
    ...s,
    has_marks: builtYearIds.has(s.academic_year_id),
  }));

  const content = buildCoverPage(student, settings, sectionsWithHasMarks, logoBase64, promotions);

  builtSections.forEach((section) => {
    const page = buildYearSection(section, section.card, section.gradingScale);
    page[0] = { ...page[0], pageBreak: "before" };
    content.push(...page);
  });

  const docDef = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [24, 16, 24, 16],
    content,
    defaultStyle: { font: "Roboto", fontSize: 7, lineHeight: 1.08 },
    ...(logoBase64 ? { images: { reportLogo: logoBase64 } } : {}),
    // Same watermark treatment as normal report cards (buildDocDefinition
    // in reportCardPdfGenerator.js) — large, low-opacity, centered on
    // every page, sized off pageSize so it stays centered whether that
    // page is the cover or a landscape year table. Applies automatically
    // to any continuation page a long subject table overflows onto too,
    // since pdfmake calls this per rendered page, not per content block.
    ...(logoBase64
      ? {
          background: (_currentPage, pageSize) => ({
            image: "reportLogo",
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
      title: `Transcript – ${student.full_name}`,
      author: "Izzy Tech Team",
      subject: "Transcript of Academic Records",
    },
  };

  const pdfBuffer = await generatePdfBuffer(docDef);
  const filename = `${sanitize(student.full_name)}-transcript.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.status(200).end(pdfBuffer);
});

module.exports = {
  getTranscript,
  getTranscriptPdf,
};
