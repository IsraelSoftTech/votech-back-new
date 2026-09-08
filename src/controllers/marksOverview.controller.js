/* controllers/marksOverview.controller.js
 *
 * Two admin-facing views that sit on top of the existing marks data,
 * neither of which changes how marks are entered or computed:
 *
 * 1. MATRIX — one class's full subject-by-student spreadsheet (reuses
 *    buildReportCardsFromMarks, the same engine report cards and the
 *    class master sheet already use), but rebuilt against the FULL class
 *    roster and the FULL set of subjects assigned to the class (via
 *    ClassSubject), not just the students/subjects that already happen
 *    to have marks — so a student or subject with zero marks still shows
 *    up as a blank row/column instead of silently disappearing.
 *
 * 2. COVERAGE — a whole-school "who hasn't filled marks yet" tracker,
 *    grouped by teacher, for a chosen sequence or term (both sequences).
 *    Computed as a plain in-memory roster-vs-marks diff over every
 *    ClassSubject assignment, not a per-assignment DB round trip.
 */

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const appResponder = require("../utils/appResponder");
const models = require("../models/index.model");
const { buildReportCardsFromMarks } = require("./reportCard.controller");
const { buildStudentWhere } = require("./student.controller");
const { printer, loadLogoBase64, prepareGrading } = require("./reportCardPdfGenerator");
const {
  applySubjectSettingsForYear,
  getSubjectSettingsForYear,
  resolveClassForYear,
  resolveSchoolSettingsForYear,
} = require("../utils/yearScopedSettings.util");
const { resolveClassMasterName } = require("../utils/classMaster.util");

const emptySubjectScores = () => ({
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
});

/* ═══════════════════════════════════════════════════════════════════
   MATRIX — GET /marks-overview/matrix
   ═══════════════════════════════════════════════════════════════════ */

// Shared by the JSON matrix endpoint and the PDF download, so what admin
// sees on screen and what gets printed/posted can never disagree — same
// "single source of truth" pattern computeCoverage below already uses for
// getMarksCoverage/downloadCoveragePdf.
async function buildMarksMatrixCards({ academicYearId, departmentId, classId }) {
  if (!academicYearId || !classId) {
    throw new AppError("academicYearId and classId are required", StatusCodes.BAD_REQUEST);
  }

  const [academicYear, studentClass, classSubjects, settings, gradingRaw] = await Promise.all([
    models.AcademicYear.findByPk(academicYearId),
    models.Class.findByPk(classId, {
      include: [{ model: models.Specialty, as: "department", attributes: ["name"] }],
    }),
    models.ClassSubject.findAll({
      // Scoped to THIS matrix's own year — class_subjects is year-scoped
      // so browsing an archived year's matrix shows who actually taught
      // it that year, not today's assignment.
      where: {
        class_id: classId,
        academic_year_id: academicYearId,
        ...(departmentId ? { department_id: departmentId } : {}),
      },
      include: [
        { model: models.Subject, as: "subject", attributes: ["id", "code", "name", "coefficient", "category"] },
        { model: models.User, as: "teacher", attributes: ["id", "name", "username"] },
      ],
    }),
    resolveSchoolSettingsForYear(academicYearId),
    // Same grading bands a report card/transcript for this class/year
    // would color its averages by — passed through so the PDF (not the
    // on-screen table, which keeps its own simpler <10 rule) can use the
    // real excellent/v.good/good/... color scale instead of a flat
    // pass/fail red.
    models.AcademicBand.findAll({
      where: { academic_year_id: academicYearId, class_id: classId },
      raw: true,
    }),
  ]);
  const gradingScale = prepareGrading(gradingRaw);

  if (!academicYear) throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
  if (!studentClass) throw new AppError("Class not found", StatusCodes.NOT_FOUND);

  const where = await buildStudentWhere({
    class_id: classId,
    department_id: departmentId,
    academic_year_id: academicYearId,
  });
  const roster = await models.Student.findAll({
    where,
    attributes: ["id", "full_name", "student_id"],
    order: [["full_name", "ASC"]],
  });

  if (!roster.length) {
    throw new AppError(
      `No students found for ${studentClass.name} in this academic year.`,
      StatusCodes.NOT_FOUND
    );
  }

  // Coefficient/category as they stood in THIS year, not whatever
  // subjects.* holds today — the same overlay every report card and
  // master sheet applies, done here by subject id because this list is
  // built from class_subjects rather than from marks.
  const subjectYearSettings = await getSubjectSettingsForYear(
    academicYearId,
    classSubjects.map((cs) => cs.subject_id).filter(Boolean)
  );

  // De-dup by subject code — a subject can appear once per department on
  // an orientation class when no departmentId filter is supplied.
  const subjectDefs = [];
  const seenCodes = new Set();
  for (const cs of classSubjects) {
    if (!cs.subject || seenCodes.has(cs.subject.code)) continue;
    seenCodes.add(cs.subject.code);
    const forYear = subjectYearSettings.get(cs.subject_id);
    const category = forYear?.category ?? cs.subject.category;
    subjectDefs.push({
      code: cs.subject.code,
      title: cs.subject.name,
      coef: forYear?.coefficient ?? cs.subject.coefficient,
      category:
        category === "professional"
          ? "professional"
          : category === "general"
          ? "general"
          : "practical",
      teacher: cs.teacher?.name || cs.teacher?.username || "Unassigned",
    });
  }

  const marks = await models.Mark.findAll({
    where: { academic_year_id: academicYearId, class_id: classId },
    include: [
      { model: models.Student, as: "student", attributes: ["id", "full_name", "student_id"] },
      { model: models.Subject, as: "subject", attributes: ["code", "name", "coefficient", "category"] },
      { model: models.Sequence, as: "sequence", attributes: ["order_number"] },
      { model: models.Term, as: "term", attributes: ["order_number"] },
    ],
  });

  await applySubjectSettingsForYear(marks, academicYearId);

  const classMasterName = await resolveClassMasterName(classId, academicYearId);
  const cards = marks.length
    ? buildReportCardsFromMarks(marks, classMasterName, "annual", settings.principal_name, settings)
    : [];
  const cardsByStudent = new Map(cards.map((c) => [c.student.id, c]));

  const classForYear = await resolveClassForYear(classId, academicYearId);
  const meta = {
    schoolName: settings.school_name,
    className: classForYear.name || studentClass.name,
    departmentName: classForYear.department_name || studentClass.department?.name || "",
    academicYear: academicYear.name,
    // Only used by the PDF letterhead (downloadMarksMatrixPdf), the JSON
    // endpoint's own consumer (MasterSheet.component.jsx) never reads
    // these, kept here anyway so both endpoints build meta from one place.
    address: settings.address || "",
    motto: settings.motto || "",
    classMaster: classMasterName,
    principal: settings.principal_name || "",
  };
  // Every card carries the exact same `administration`/`student` shape
  // buildReportCardsFromMarks produces, whether or not that student has
  // any marks — the frontend (MasterSheet component) only reads column
  // definitions and meta off the FIRST card in the array, so it can never
  // be missing here.
  const administration = {
    classMaster: classMasterName,
    principal: settings.principal_name,
    nextTermStarts: "",
    decision: "",
    parents: "N/A",
  };

  const finalCards = roster.map((student) => {
    const existing = cardsByStudent.get(student.id);
    const existingByCode = new Map();
    if (existing) {
      for (const s of [
        ...existing.generalSubjects,
        ...existing.professionalSubjects,
        ...existing.practicalSubjects,
      ]) {
        existingByCode.set(s.code, s);
      }
    }

    const card = {
      student: {
        id: student.id,
        name: student.full_name,
        registrationNumber: student.student_id,
        class: meta.className,
        option: meta.departmentName,
        academicYear: meta.academicYear,
      },
      generalSubjects: [],
      professionalSubjects: [],
      practicalSubjects: [],
      termTotals: existing?.termTotals || { term1: {}, term2: {}, term3: {}, annual: {} },
      administration,
    };

    for (const def of subjectDefs) {
      const found = existingByCode.get(def.code);
      const row = {
        code: def.code,
        title: def.title,
        coef: def.coef,
        teacher: def.teacher,
        scores: found ? found.scores : emptySubjectScores(),
      };
      if (def.category === "professional") card.professionalSubjects.push(row);
      else if (def.category === "general") card.generalSubjects.push(row);
      else card.practicalSubjects.push(row);
    }

    return card;
  });

  return { finalCards, meta, gradingScale };
}

const getMarksMatrix = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId } = req.query;
  let finalCards;
  try {
    ({ finalCards } = await buildMarksMatrixCards({ academicYearId, departmentId, classId }));
  } catch (err) {
    return next(err);
  }
  appResponder(StatusCodes.OK, finalCards, res);
});

/* ═══════════════════════════════════════════════════════════════════
   COVERAGE — GET /marks-overview/coverage
   ═══════════════════════════════════════════════════════════════════ */

// Shared by the JSON tracker endpoint and the PDF nudge, so what admin
// sees on screen and what gets posted to the teachers' WhatsApp group can
// never disagree.
async function computeCoverage({ academicYearId, sequenceId, termId, teacherId }) {
  if (!academicYearId) {
    throw new AppError("academicYearId is required", StatusCodes.BAD_REQUEST);
  }
  if (!sequenceId && !termId) {
    throw new AppError("sequenceId or termId is required", StatusCodes.BAD_REQUEST);
  }

  const sequences = sequenceId
    ? await models.Sequence.findAll({ where: { id: sequenceId } })
    : await models.Sequence.findAll({ where: { term_id: termId }, order: [["order_number", "ASC"]] });

  if (!sequences.length) {
    throw new AppError("Sequence(s) not found", StatusCodes.NOT_FOUND);
  }
  const seqIds = sequences.map((s) => s.id);
  const seqLabelById = new Map(sequences.map((s) => [s.id, s.name || `Sequence ${s.order_number}`]));

  const [classSubjects, students, markRows] = await Promise.all([
    models.ClassSubject.findAll({
      // Coverage is "who needs to fill marks right now" — an operational,
      // present-tense question, so it's scoped to the academic year the
      // caller is actually asking about (usually the active one), not
      // some other year's frozen assignment history.
      where: { academic_year_id: academicYearId, ...(teacherId ? { teacher_id: teacherId } : {}) },
      include: [
        { model: models.Subject, as: "subject", attributes: ["id", "code", "name"] },
        { model: models.User, as: "teacher", attributes: ["id", "name", "username"] },
        { model: models.Class, as: "class", attributes: ["id", "name", "department_id"] },
      ],
    }),
    models.Student.findAll({
      where: { academic_year_id: academicYearId },
      attributes: ["id", "full_name", "class_id"],
      raw: true,
    }),
    models.Mark.findAll({
      where: { academic_year_id: academicYearId, sequence_id: { [Op.in]: seqIds } },
      attributes: ["student_id", "subject_id", "class_id", "sequence_id"],
      raw: true,
    }),
  ]);

  const studentsByClass = new Map();
  for (const s of students) {
    if (!studentsByClass.has(s.class_id)) studentsByClass.set(s.class_id, []);
    studentsByClass.get(s.class_id).push(s);
  }

  const markedSet = new Set(
    markRows.map((m) => `${m.student_id}-${m.subject_id}-${m.class_id}-${m.sequence_id}`)
  );

  const assignments = [];
  for (const cs of classSubjects) {
    if (!cs.subject || !cs.class) continue;
    const roster = studentsByClass.get(cs.class_id) || [];
    const rosterCount = roster.length;
    const totalPairs = rosterCount * seqIds.length;

    let filledPairs = 0;
    const missingByStudent = new Map(); // student_id -> [seqId, ...]
    for (const student of roster) {
      const missingSeqIds = [];
      for (const seqId of seqIds) {
        const key = `${student.id}-${cs.subject.id}-${cs.class_id}-${seqId}`;
        if (markedSet.has(key)) filledPairs++;
        else missingSeqIds.push(seqId);
      }
      if (missingSeqIds.length) missingByStudent.set(student.id, missingSeqIds);
    }

    const status =
      rosterCount === 0
        ? "no_roster"
        : filledPairs === 0
        ? "not_started"
        : filledPairs === totalPairs
        ? "complete"
        : "partial";

    const missingStudents = roster
      .filter((s) => missingByStudent.has(s.id))
      .map((s) => {
        const missingSeqIds = missingByStudent.get(s.id);
        const seqNote =
          seqIds.length > 1 && missingSeqIds.length < seqIds.length
            ? ` (${missingSeqIds.map((id) => seqLabelById.get(id)).join(" & ")})`
            : "";
        return { id: s.id, name: s.full_name, note: seqNote };
      });

    assignments.push({
      classSubjectId: cs.id,
      classId: cs.class_id,
      className: cs.class.name,
      departmentId: cs.class.department_id,
      subjectId: cs.subject.id,
      subjectCode: cs.subject.code,
      subjectTitle: cs.subject.name,
      teacherId: cs.teacher_id,
      teacherName: cs.teacher?.name || cs.teacher?.username || "Unassigned",
      rosterCount,
      filledPairs,
      totalPairs,
      status,
      missingStudents,
    });
  }

  const scored = assignments.filter((a) => a.status !== "no_roster");
  const summary = {
    sequenceLabel: sequences.length > 1 ? `${sequences.length} sequences` : seqLabelById.get(seqIds[0]),
    totalAssignments: scored.length,
    complete: scored.filter((a) => a.status === "complete").length,
    partial: scored.filter((a) => a.status === "partial").length,
    notStarted: scored.filter((a) => a.status === "not_started").length,
  };

  const byTeacher = new Map();
  for (const a of assignments) {
    if (a.status === "no_roster") continue;
    const key = a.teacherId || `unassigned-${a.subjectCode}-${a.classId}`;
    if (!byTeacher.has(key)) byTeacher.set(key, { teacherId: a.teacherId, teacherName: a.teacherName, assignments: [] });
    byTeacher.get(key).assignments.push(a);
  }

  const teacherRows = Array.from(byTeacher.values())
    .map((t) => ({
      ...t,
      worstStatus: t.assignments.some((a) => a.status === "not_started")
        ? "not_started"
        : t.assignments.some((a) => a.status === "partial")
        ? "partial"
        : "complete",
    }))
    .sort((a, b) => {
      const rank = { not_started: 0, partial: 1, complete: 2 };
      return rank[a.worstStatus] - rank[b.worstStatus] || a.teacherName.localeCompare(b.teacherName);
    });

  return { summary, teacherRows };
}

const getMarksCoverage = catchAsync(async (req, res, next) => {
  const { academicYearId, sequenceId, termId } = req.query;
  try {
    const data = await computeCoverage({ academicYearId, sequenceId, termId });
    appResponder(StatusCodes.OK, data, res);
  } catch (err) {
    return next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   COVERAGE PDF — GET /marks-overview/coverage-pdf
   ═══════════════════════════════════════════════════════════════════ */

const MAX_NAMES_LISTED = 8;

function statusLabel(status) {
  if (status === "complete") return "Complete";
  if (status === "partial") return "Partial";
  return "Not Started";
}

// Same chrome as the marks matrix PDF (mxFullLetterhead/mxInfoGrid/
// mxSectionBar/mxStatStrip/mxHdrCell, all defined below), so a downloaded
// compliance report reads as the same family of document instead of the
// plainer one-off look this file used to build for it.
function buildCoveragePdfDoc({ summary, teacherRows }, meta, logoBase64) {
  const content = [];

  content.push(
    mxFullLetterhead("MARKS COMPLETION STATUS", `${(summary.sequenceLabel || "").toUpperCase()} • ${meta.academicYearName}`, meta, logoBase64)
  );
  content.push({ text: "", margin: [0, 8, 0, 0] });
  content.push(
    mxInfoGrid([
      ["Sequence/Term", summary.sequenceLabel],
      ["Academic Year", meta.academicYearName],
      ["Generated", meta.generatedAt],
      ["Total Assignments", String(summary.totalAssignments)],
    ])
  );

  content.push(mxSectionBar("Completion Overview"));
  content.push(
    mxStatStrip([
      { k: "Complete", v: String(summary.complete), color: MX_C.excellent },
      { k: "Partial", v: String(summary.partial), color: MX_C.average },
      { k: "Not Started", v: String(summary.notStarted), color: MX_C.weak },
      { k: "Total", v: String(summary.totalAssignments) },
    ])
  );

  const statusColor = (status) =>
    status === "complete" ? MX_C.excellent : status === "partial" ? MX_C.average : MX_C.weak;

  for (const t of teacherRows) {
    content.push(mxSectionBar(t.teacherName));

    const body = [[mxHdrCell("Class, Subject"), mxHdrCell("Status"), mxHdrCell("Detail")]];
    t.assignments.forEach((a) => {
      const names = a.missingStudents.slice(0, MAX_NAMES_LISTED).map((s) => s.name + s.note);
      const extra = a.missingStudents.length - names.length;
      const detail =
        a.status === "complete"
          ? "All marks entered"
          : a.status === "not_started"
          ? `Not started, ${a.rosterCount} students`
          : names.join(", ") + (extra > 0 ? `, +${extra} more` : "");
      body.push([
        { text: `${a.className}, ${a.subjectTitle}`, fontSize: 8.5, color: MX_C.dark },
        { text: statusLabel(a.status), fontSize: 8.5, bold: true, color: statusColor(a.status), alignment: "center" },
        { text: detail, fontSize: 8, color: a.status === "complete" ? MX_C.excellent : MX_C.weak },
      ]);
    });

    content.push({
      table: { headerRows: 1, widths: [150, 70, "*"], body },
      layout: {
        fillColor: (rowIndex) => (rowIndex > 0 && rowIndex % 2 === 0 ? MX_C.cardBg : null),
        hLineWidth: (i) => (i <= 1 ? 1 : 0.5),
        vLineWidth: () => 0.3,
        hLineColor: () => MX_BORDER_SOFT,
        vLineColor: () => MX_BORDER_FAINT,
        paddingTop: () => 3,
        paddingBottom: () => 3,
        paddingLeft: () => 4,
        paddingRight: () => 4,
      },
      margin: [0, 0, 0, 12],
    });
  }

  return withMatrixLogoWatermark(
    {
      pageSize: "A4",
      pageMargins: [30, 30, 30, 30],
      content,
      defaultStyle: { font: "Roboto", fontSize: 8.5 },
      footer: (currentPage, pageCount) => ({
        text: `Page ${currentPage} of ${pageCount}`,
        fontSize: 7,
        color: MX_C.light,
        alignment: "center",
      }),
      info: { title: "Marks_Completion_Status", author: "School Administration Tech Engine" },
    },
    logoBase64
  );
}

const downloadCoveragePdf = catchAsync(async (req, res, next) => {
  const { academicYearId, sequenceId, termId } = req.query;
  let data, academicYear, settings;
  try {
    [data, academicYear, settings] = await Promise.all([
      computeCoverage({ academicYearId, sequenceId, termId }),
      models.AcademicYear.findByPk(academicYearId),
      resolveSchoolSettingsForYear(academicYearId),
    ]);
  } catch (err) {
    return next(err);
  }

  const meta = {
    schoolName: settings.school_name,
    address: settings.address || "",
    motto: settings.motto || "",
    academicYearName: academicYear?.name || "",
    generatedAt: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
  };
  const logoBase64 = loadLogoBase64();
  const docDefinition = buildCoveragePdfDoc(data, meta, logoBase64);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="Marks_Completion_Status.pdf"');

  try {
    const doc = printer.createPdfKitDocument(docDefinition);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    if (!res.headersSent) {
      return next(new AppError("PDF generation failed: " + (err.message || ""), StatusCodes.INTERNAL_SERVER_ERROR));
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════
   MATRIX PDF, GET /marks-overview/matrix-pdf

   Ported from the frontend's MasterSheet.component.jsx, which used to
   build this entire document client-side with pdfmake, no access to
   the server's logo asset or the shared printer/styling every other
   document (report cards, transcripts, the master sheet booklet) uses,
   which is why it used to look like it came from a different app. Same
   two formats as before (a wide "wall poster" for a notice board, and a
   compact A4 layout for reviewing on paper), same column-chunking logic
   for wide classes, now rendered through the shared `printer` with the
   same logo watermark reportCardPdfGenerator.js uses.
   ═══════════════════════════════════════════════════════════════════ */

// Exactly the palette transcript.controller.js / reportCardPdfGenerator.js
// use (their own local `C` object), not this file's existing top-of-file
// `C` (which downloadCoveragePdf already relies on for its own, different
// look), so a downloaded matrix reads as the same kind of document as a
// report card or transcript instead of inventing its own color scheme.
const MX_C = {
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
const MX_HEADER_TINT = "#e8edf7"; // soft navy tint for the sub-column label tier only
const MX_BORDER_SOFT = "#cccccc";
const MX_BORDER_FAINT = "#dddddd";

// Solid navy fill + white bold text, the exact treatment transcript.
// controller.js's hdrCell() uses for every table header, instead of the
// pale-tint-with-black-text headers this file used to draw.
function mxHdrCell(text, extra = {}) {
  return {
    text,
    bold: true,
    fontSize: 6.5,
    color: "#fff",
    fillColor: MX_C.primary,
    alignment: "center",
    margin: [0, 3, 0, 3],
    ...extra,
  };
}

// Same grading-band lookup transcript.controller.js's getRemark/
// remarkColor use, so a final/annual average is colored by the actual
// excellent/v.good/good/fairly good/average/weak scale instead of a flat
// pass-or-fail red, matches how the same number would be colored on
// that student's own report card or transcript.
function mxColorForAverage(avg, gradingScale) {
  if (avg == null || Number.isNaN(Number(avg))) return MX_C.dark;
  const band = (gradingScale || []).find((g) => avg >= g.band_min && avg <= g.band_max);
  const remark = band ? band.comment : "";
  const n = String(remark || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const map = {
    excellent: MX_C.excellent,
    "v good": MX_C.vgood,
    "very good": MX_C.vgood,
    good: MX_C.good,
    "fairly good": MX_C.fairlyGood,
    average: MX_C.average,
    weak: MX_C.weak,
  };
  return map[n] || MX_C.dark;
}

// Same 380x380 / opacity 0.04 / centered watermark reportCardPdfGenerator.js
// uses for report cards, so a downloaded matrix reads as the same kind of
// official document instead of a different-looking one-off.
function withMatrixLogoWatermark(docDefinition, logoBase64) {
  if (!logoBase64) return docDefinition;
  return {
    ...docDefinition,
    images: { reportLogo: logoBase64 },
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
  };
}

// Full bilingual government letterhead, matching reportCardPdfGenerator.
// js's buildHeader almost verbatim (same French/English ministry lines,
// same centered logo + tagline + motto block, same card background),
// just with a caller-supplied title/subtitle instead of that function's
// hardcoded "ACADEMIC REPORT CARD"; buildHeader itself isn't exported,
// so this is a parameterized sibling rather than a copy that drifts.
// Used once, on the A4 format's first page, same as a report card only
// ever shows its own letterhead once.
function mxFullLetterhead(title, subtitle, meta, logoBase64) {
  const schoolName = (meta.schoolName || "VOTECH S7 ACADEMY").toUpperCase();
  const address = meta.address || "AZIRE - MANKON";
  const motto = meta.motto || "Welfare, Productivity, Self Actualization";

  const frenchSide = [
    { text: "REPUBLIQUE DU CAMEROUN", fontSize: 7, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "PAIX - TRAVAIL - PATRIE", fontSize: 6, bold: true, italics: true, color: MX_C.gold, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "MINISTERE DE L'EMPLOI ET DE LA\nFORMATION PROFESSIONNELLE", fontSize: 6.5, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "DIRECTION DE L'ENSEIGNEMENT PRIVE", fontSize: 6, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: schoolName, fontSize: 7, bold: true, color: MX_C.primary, alignment: "center", characterSpacing: 0.5, margin: [0, 0, 0, 0.5] },
    { text: address, fontSize: 6, bold: true, color: MX_C.light, alignment: "center" },
  ];
  const englishSide = [
    { text: "REPUBLIC OF CAMEROON", fontSize: 7, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "PEACE - WORK - FATHERLAND", fontSize: 6, bold: true, italics: true, color: MX_C.gold, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "MINISTRY OF EMPLOYMENT AND\nVOCATIONAL TRAINING", fontSize: 6.5, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "DEPARTMENT OF PRIVATE\nVOCATIONAL INSTITUTE", fontSize: 6, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: schoolName, fontSize: 7, bold: true, color: MX_C.primary, alignment: "center", characterSpacing: 0.5, margin: [0, 0, 0, 0.5] },
    { text: address, fontSize: 6, bold: true, color: MX_C.light, alignment: "center" },
  ];

  const centerContent = [];
  if (logoBase64) {
    centerContent.push({ image: "reportLogo", width: 40, height: 40, alignment: "center", margin: [0, 0, 0, 2] });
  }
  centerContent.push(
    { text: schoolName, fontSize: 7, bold: true, color: MX_C.primary, alignment: "center", characterSpacing: 0.5, margin: [0, 0, 0, 1] },
    { text: `Motto: ${motto}`, fontSize: 6, bold: true, italics: true, color: MX_C.gold, alignment: "center" }
  );

  return {
    table: {
      widths: ["*"],
      body: [[
        {
          fillColor: MX_C.cardBg,
          stack: [
            {
              columns: [
                { width: "*", stack: frenchSide },
                { width: 120, stack: centerContent },
                { width: "*", stack: englishSide },
              ],
              columnGap: 6,
              margin: [0, 4, 0, 4],
            },
            { text: title, fontSize: 11, bold: true, color: MX_C.primary, alignment: "center", characterSpacing: 1.5, margin: [0, 2, 0, 1] },
            { text: subtitle, fontSize: 8, color: MX_C.light, alignment: "center", margin: [0, 0, 0, 4] },
          ],
        },
      ]],
    },
    layout: { hLineWidth: (i) => (i === 1 ? 2 : 0), vLineWidth: () => 0, hLineColor: () => MX_C.gold },
  };
}

// Lighter letterhead for a page that repeats on every sheet (the wall
// poster's per-page-slice header). Still the bilingual ministry block,
// same as the A4 letterhead, just the two-line mini version (country +
// motto only, no ministry/directorate lines) either side of a small
// centered logo, since the full 6-line block would eat too much of a
// landscape page's height repeated on every sheet.
function mxWallLetterhead(title, meta, logoBase64) {
  const frenchSide = [
    { text: "REPUBLIQUE DU CAMEROUN", fontSize: 6.5, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "PAIX - TRAVAIL - PATRIE", fontSize: 5.5, bold: true, italics: true, color: MX_C.gold, alignment: "center" },
  ];
  const englishSide = [
    { text: "REPUBLIC OF CAMEROON", fontSize: 6.5, bold: true, color: MX_C.primary, alignment: "center", margin: [0, 0, 0, 0.5] },
    { text: "PEACE - WORK - FATHERLAND", fontSize: 5.5, bold: true, italics: true, color: MX_C.gold, alignment: "center" },
  ];
  const centerContent = [];
  if (logoBase64) {
    centerContent.push({ image: "reportLogo", width: 26, height: 26, alignment: "center" });
  }
  return {
    stack: [
      {
        columns: [
          { width: "*", stack: frenchSide },
          { width: 60, stack: centerContent },
          { width: "*", stack: englishSide },
        ],
        columnGap: 6,
        margin: [0, 0, 0, 4],
      },
      { text: title, fontSize: 12, bold: true, color: MX_C.primary, alignment: "center", characterSpacing: 0.5, margin: [0, 0, 0, 4] },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 821, y2: 0, lineWidth: 1, lineColor: MX_C.gold }], margin: [0, 0, 0, 6] },
    ],
  };
}

// Full-width solid navy bar, white bold centered text; the section
// divider used throughout the A4 format (Class Overview, each subject
// group's detail page), matching transcript.controller.js's own visual
// language for a "here's a new part of the document" marker instead of
// a plain line of text.
function mxSectionBar(text) {
  return {
    table: { widths: ["*"], body: [[{ text, bold: true, fontSize: 9.5, color: "#fff", fillColor: MX_C.primary, alignment: "center", margin: [0, 4, 0, 4] }]] },
    layout: "noBorders",
    margin: [0, 0, 0, 8],
  };
}

// Bordered two-column meta grid, same treatment the report card itself
// uses for Student Name / Class / Registration No. / etc. `pairs` is
// [[label, value], ...], laid out two per row.
function mxInfoGrid(pairs) {
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const [l1, v1] = pairs[i];
    const [l2, v2] = pairs[i + 1] || ["", ""];
    rows.push([
      { text: [{ text: l1 + ": ", bold: true, color: MX_C.primary }, { text: v1, color: MX_C.dark }], fontSize: 9 },
      { text: l2 ? [{ text: l2 + ": ", bold: true, color: MX_C.primary }, { text: v2, color: MX_C.dark }] : "", fontSize: 9 },
    ]);
  }
  return {
    table: { widths: ["*", "*"], body: rows },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => 1,
      hLineColor: () => MX_BORDER_FAINT,
      vLineColor: () => MX_BORDER_FAINT,
      paddingTop: () => 5,
      paddingBottom: () => 5,
      paddingLeft: () => 10,
      paddingRight: () => 10,
    },
    margin: [0, 0, 0, 10],
  };
}

// Gold-bordered stat strip (Students / Class Avg / Highest / Lowest),
// shared by both formats instead of each drawing its own summary row.
function mxStatStrip(items) {
  return {
    table: {
      widths: items.map(() => "*"),
      body: [items.map((it) => ({
        stack: [
          { text: it.k, fontSize: 6.5, bold: true, color: MX_C.light, alignment: "center", characterSpacing: 0.3, margin: [0, 3, 0, 1] },
          { text: it.v, fontSize: 12, bold: true, color: it.color || MX_C.primary, alignment: "center", margin: [0, 0, 0, 3] },
        ],
      }))],
    },
    layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => MX_C.gold, vLineColor: () => MX_C.gold },
    margin: [0, 4, 0, 10],
  };
}

// Three-box footer for the A4 format, the same shape the report card's
// own Conduct/Grading/Administration row uses: Grading Scale on the
// left, generation details in the middle, class master's signature line
// on the right.
function mxFooterBoxes(gradingScale, meta, generatedAt, extra = {}) {
  const bands = (gradingScale && gradingScale.length ? gradingScale : [
    { band_min: 18, band_max: 20, comment: "Excellent" },
    { band_min: 16, band_max: 17.99, comment: "Very Good" },
    { band_min: 13, band_max: 15.99, comment: "Good" },
    { band_min: 10, band_max: 12.99, comment: "Average" },
    { band_min: 0, band_max: 9.99, comment: "Weak" },
  ]);
  const gradingRows = bands.map((b) => [
    { text: `${mxFmt(b.band_min)}-${mxFmt(b.band_max)}`, fontSize: 7.5, color: MX_C.dark },
    { text: b.comment, fontSize: 7.5, bold: true, color: mxColorForAverage((b.band_min + b.band_max) / 2, bands), alignment: "right" },
  ]);

  const box = (headerText, bodyContent) => ({
    stack: [
      { table: { widths: ["*"], body: [[{ text: headerText, bold: true, fontSize: 8, color: "#fff", fillColor: MX_C.primary, alignment: "center", margin: [0, 3, 0, 3] }]] }, layout: "noBorders" },
      { margin: [8, 6, 8, 6], stack: bodyContent },
    ],
  });

  const signBox = (headerText, name) =>
    box(headerText, [
      { text: " ", margin: [0, 10, 0, 0] },
      { canvas: [{ type: "line", x1: 10, y1: 0, x2: 110, y2: 0, lineWidth: 0.75, lineColor: MX_C.dark }], margin: [0, 0, 0, 3] },
      { text: (name || "-").toUpperCase(), fontSize: 8, bold: true, alignment: "center" },
      { text: "Date & Signature", fontSize: 6.5, italics: true, color: MX_C.light, alignment: "center" },
    ]);

  return {
    columns: [
      { width: "28%", ...box("Grading Scale", [{ table: { widths: ["*", "*"], body: gradingRows }, layout: "noBorders" }]) },
      {
        width: "24%",
        ...box("Document Info", [
          { text: [{ text: "Generated: ", color: MX_C.light }, { text: generatedAt, color: MX_C.dark }], fontSize: 7.5, margin: [0, 0, 0, 3] },
          { text: [{ text: "Term: ", color: MX_C.light }, { text: extra.termLabel || "", color: MX_C.dark }], fontSize: 7.5, margin: [0, 0, 0, 3] },
          { text: [{ text: "Students: ", color: MX_C.light }, { text: String(extra.studentCount ?? ""), color: MX_C.dark }], fontSize: 7.5 },
        ]),
      },
      { width: "24%", ...signBox("Class Master", meta.classMaster) },
      { width: "24%", ...signBox("Principal", meta.principal) },
    ],
    columnGap: 0,
  };
}

function mxFmt(v) {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}

function mxIsNum(n) {
  const v = typeof n === "number" ? n : parseFloat(n);
  return !isNaN(v);
}

function mxAverageOf(values = []) {
  const nums = (values || [])
    .map((v) => (typeof v === "number" ? v : parseFloat(v)))
    .filter((v) => !isNaN(v));
  if (!nums.length) return "";
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(avg * 10) / 10;
}

// Matches transcript.controller.js's own restraint: only the FINAL/annual
// average gets graded-band coloring, individual sequence marks and term
// averages stay plain dark text (bold marks them out typographically
// instead), coloring every single cell reads as noisy, not official.
function mxValueColor(key, raw, gradingScale) {
  const k = (key || "").toLowerCase();
  const isFinal = k === "finalavg" || k === "annualavg";
  if (!isFinal) return MX_C.dark;
  const n = parseFloat(raw);
  if (isNaN(n)) return MX_C.dark;
  return mxColorForAverage(n, gradingScale);
}

function mxGetSubjectRaw(subjScores, key) {
  if (!subjScores) return "";
  if (key === "coef") return subjScores.coef ?? "";
  if (key === "finalAvg") {
    const direct =
      subjScores.finalAvg ?? subjScores.finalCumulativeAverage ?? subjScores.annualAvg;
    if (mxIsNum(direct)) return Number(direct);
    const avg = mxAverageOf([subjScores.term1Avg, subjScores.term2Avg, subjScores.term3Avg]);
    return mxIsNum(avg) ? Number(avg) : "";
  }
  return subjScores[key] ?? "";
}

function mxGetTotalsRaw(st, key, term) {
  if (st.termTotals) {
    if (key === "rank") {
      if (term === "term1") return st.termTotals.term1?.rank ?? "";
      if (term === "term2") return st.termTotals.term2?.rank ?? "";
      if (term === "term3") return st.termTotals.term3?.rank ?? "";
      return st.termTotals.annual?.rank ?? "";
    }
    const k = key.toLowerCase();
    if (k.includes("annual")) return st.termTotals.annual?.average ?? "";
    if (k.includes("term1")) return st.termTotals.term1?.average ?? "";
    if (k.includes("term2")) return st.termTotals.term2?.average ?? "";
    if (k.includes("term3")) return st.termTotals.term3?.average ?? "";
  }
  if (st.totals && st.totals[term]) return st.totals[term][key] ?? "";
  return "";
}

function mxGetRankValue(st, term) {
  if (!st.termTotals) return 999;
  if (term === "term1") return parseInt(st.termTotals.term1?.rank) || 999;
  if (term === "term2") return parseInt(st.termTotals.term2?.rank) || 999;
  if (term === "term3") return parseInt(st.termTotals.term3?.rank) || 999;
  return parseInt(st.termTotals.annual?.rank) || 999;
}

function mxGetTermAverage(st, term) {
  if (!st.termTotals) return "";
  if (term === "term1") return st.termTotals.term1?.average ?? "";
  if (term === "term2") return st.termTotals.term2?.average ?? "";
  if (term === "term3") return st.termTotals.term3?.average ?? "";
  return st.termTotals.annual?.average ?? "";
}

function mxGetSubjectSubcolumns(term) {
  if (term === "term1")
    return [
      { key: "seq1", label: "S1" },
      { key: "seq2", label: "S2" },
      { key: "term1Avg", label: "T1 Avg" },
      { key: "coef", label: "Coef" },
    ];
  if (term === "term2")
    return [
      { key: "seq3", label: "S3" },
      { key: "seq4", label: "S4" },
      { key: "term2Avg", label: "T2 Avg" },
      { key: "coef", label: "Coef" },
    ];
  if (term === "term3")
    return [
      { key: "seq5", label: "S5" },
      { key: "seq6", label: "S6" },
      { key: "term3Avg", label: "T3 Avg" },
      { key: "coef", label: "Coef" },
    ];
  return [
    { key: "seq1", label: "S1" },
    { key: "seq2", label: "S2" },
    { key: "term1Avg", label: "T1 Avg" },
    { key: "seq3", label: "S3" },
    { key: "seq4", label: "S4" },
    { key: "term2Avg", label: "T2 Avg" },
    { key: "seq5", label: "S5" },
    { key: "seq6", label: "S6" },
    { key: "term3Avg", label: "T3 Avg" },
    { key: "finalAvg", label: "Final Avg" },
    { key: "coef", label: "Coef" },
  ];
}

function mxGetTotalsColumns(term) {
  if (term === "term1")
    return [
      { key: "term1Avg", label: "1st Term Avg" },
      { key: "rank", label: "Rank" },
    ];
  if (term === "term2")
    return [
      { key: "term2Avg", label: "2nd Term Avg" },
      { key: "rank", label: "Rank" },
    ];
  if (term === "term3")
    return [
      { key: "term3Avg", label: "3rd Term Avg" },
      { key: "rank", label: "Rank" },
    ];
  return [
    { key: "term1Avg", label: "1st Term Avg" },
    { key: "term2Avg", label: "2nd Term Avg" },
    { key: "term3Avg", label: "3rd Term Avg" },
    { key: "annualAvg", label: "Annual Avg" },
    { key: "rank", label: "Rank" },
  ];
}

// Reshapes the cards array (same shape buildMarksMatrixCards/getMarksMatrix
// returns to the frontend) into the flat column/row structure both PDF
// builders below consume.
// `extraMeta` (address/motto) comes from buildMarksMatrixCards's own meta
// object, not from the cards themselves, an individual student card has
// no reason to carry the school's postal address on it.
function prepareMatrixPdfData(payload, term, extraMeta = {}) {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const firstRC = payload[0] || {};
  const studentMeta = firstRC.student || {};

  const schoolName = payload.schoolName || studentMeta.schoolName || "School";
  const departmentName = studentMeta.option || studentMeta.department || "Department";
  const className = studentMeta.class || "Class";
  const academicYear = studentMeta.academicYear || "Not set";

  const toDef = (s) => ({ code: s.code, title: s.title, coef: s.coef });
  const generalDefs = (firstRC.generalSubjects || []).map(toDef);
  const professionalDefs = (firstRC.professionalSubjects || []).map(toDef);
  const practicalDefs = (firstRC.practicalSubjects || []).map(toDef);

  const students = payload.map((rc) => {
    const subjMap = {};
    (rc.generalSubjects || []).forEach((s) => {
      subjMap[s.code] = { ...(s.scores || {}), coef: s.coef, title: s.title };
    });
    (rc.professionalSubjects || []).forEach((s) => {
      subjMap[s.code] = { ...(s.scores || {}), coef: s.coef, title: s.title };
    });
    (rc.practicalSubjects || []).forEach((s) => {
      subjMap[s.code] = { ...(s.scores || {}), coef: s.coef, title: s.title };
    });
    const tt = rc.termTotals || {};
    return {
      studentId: rc.student?.registrationNumber || rc.student?.student_id || rc.student?.id || "",
      name: rc.student?.full_name || rc.student?.name || "",
      subjects: subjMap,
      termTotals: {
        term1: { average: tt.term1?.average ?? "", rank: tt.term1?.rank ?? "" },
        term2: { average: tt.term2?.average ?? "", rank: tt.term2?.rank ?? "" },
        term3: { average: tt.term3?.average ?? "", rank: tt.term3?.rank ?? "" },
        annual: {
          average:
            tt.annual?.average ??
            mxAverageOf([tt.term1?.average, tt.term2?.average, tt.term3?.average]),
          rank: tt.annual?.rank ?? "",
        },
      },
    };
  });

  return {
    metadata: {
      schoolName,
      departmentName,
      className,
      academicYear,
      address: extraMeta.address || "",
      motto: extraMeta.motto || "",
    },
    subjects: { general: generalDefs, professional: professionalDefs, practical: practicalDefs },
    students,
    subjectSubcolumns: mxGetSubjectSubcolumns(term),
    totalsColumns: mxGetTotalsColumns(term),
    administration: firstRC.administration || null,
  };
}

function computeMatrixStats(students = [], term = "annual") {
  const values = students
    .map((st) => {
      const tt = st.termTotals || {};
      if (term === "term1") return parseFloat(tt.term1?.average);
      if (term === "term2") return parseFloat(tt.term2?.average);
      if (term === "term3") return parseFloat(tt.term3?.average);
      return parseFloat(tt.annual?.average);
    })
    .filter((n) => typeof n === "number" && !isNaN(n));

  if (!values.length) {
    return { classAverage: "", highestAverage: "", lowestAverage: "", count: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    classAverage: Math.round((sum / values.length) * 10) / 10,
    highestAverage: Math.max(...values),
    lowestAverage: Math.min(...values),
    count: values.length,
  };
}

// A4 "meeting format", class overview ranked table, then per-subject
// breakdown pages. Compact/portrait, meant to be read at a desk.
function buildMatrixA4Doc(prepared, selectedTerm, stats, logoBase64, gradingScale) {
  const { metadata, subjects, students, subjectSubcolumns, administration } = prepared;

  const termLabel =
    selectedTerm === "term1" ? "First Term"
    : selectedTerm === "term2" ? "Second Term"
    : selectedTerm === "term3" ? "Third Term"
    : "Annual";

  const content = [];

  content.push(
    mxFullLetterhead("CLASS MASTER SHEET", `${termLabel.toUpperCase()} • ${metadata.academicYear}`, metadata, logoBase64)
  );
  content.push({ text: "", margin: [0, 8, 0, 0] });
  content.push(
    mxInfoGrid([
      ["Class", metadata.className],
      ["Department", metadata.departmentName],
      ["Academic Year", metadata.academicYear],
      ["Class Master", administration?.classMaster || "Not set"],
    ])
  );

  content.push(mxSectionBar("Class Overview, Ranked by Annual Average"));

  const overviewHeaders = [
    mxHdrCell("Rank"),
    mxHdrCell("Student Name"),
    mxHdrCell("Student ID"),
  ];
  if (selectedTerm === "annual") {
    overviewHeaders.push(mxHdrCell("T1 Avg"), mxHdrCell("T2 Avg"), mxHdrCell("T3 Avg"), mxHdrCell("Annual"));
  } else {
    const termAvgLabel = selectedTerm === "term1" ? "T1 Avg" : selectedTerm === "term2" ? "T2 Avg" : "T3 Avg";
    overviewHeaders.push(mxHdrCell(termAvgLabel));
  }
  overviewHeaders.push(mxHdrCell("Status"));

  const sortedStudents = [...students].sort(
    (a, b) => mxGetRankValue(a, selectedTerm) - mxGetRankValue(b, selectedTerm)
  );

  const overviewBody = [overviewHeaders];
  sortedStudents.forEach((st, idx) => {
    const row = [];
    const rank = mxGetRankValue(st, selectedTerm);
    const avg = mxGetTermAverage(st, selectedTerm);
    const passed = parseFloat(avg) >= 10;

    row.push({ text: String(rank || idx + 1), alignment: "center", fontSize: 8.5 });
    row.push({ text: st.name, alignment: "left", fontSize: 8.5 });
    row.push({ text: st.studentId, alignment: "center", fontSize: 8.5 });

    // Matches transcript.controller.js's buildYearSummary: term/annual
    // averages in this "totals" row are bold navy, not graded; grading
    // colors are reserved for the FINAL average in the detailed subject
    // tables below, same restraint as the transcript itself.
    if (selectedTerm === "annual") {
      row.push({ text: mxFmt(st.termTotals?.term1?.average), alignment: "center", fontSize: 8.5, color: MX_C.primary });
      row.push({ text: mxFmt(st.termTotals?.term2?.average), alignment: "center", fontSize: 8.5, color: MX_C.primary });
      row.push({ text: mxFmt(st.termTotals?.term3?.average), alignment: "center", fontSize: 8.5, color: MX_C.primary });
      row.push({ text: mxFmt(st.termTotals?.annual?.average), alignment: "center", fontSize: 9, bold: true, color: MX_C.primary });
    } else {
      row.push({ text: mxFmt(avg), alignment: "center", fontSize: 9, bold: true, color: MX_C.primary });
    }

    row.push({ text: passed ? "PASS" : "FAIL", alignment: "center", bold: true, fontSize: 8.5, color: passed ? MX_C.excellent : MX_C.weak });
    overviewBody.push(row);
  });

  const overviewWidths =
    selectedTerm === "annual"
      ? ["auto", "*", "auto", "auto", "auto", "auto", "auto", "auto"]
      : ["auto", "*", "auto", "auto", "auto"];

  content.push({
    table: { headerRows: 1, widths: overviewWidths, body: overviewBody },
    layout: {
      fillColor: (rowIndex) => (rowIndex > 0 && rowIndex % 2 === 0 ? MX_C.cardBg : null),
      hLineWidth: (i) => (i <= 1 ? 1 : 0.5),
      vLineWidth: () => 0.3,
      hLineColor: () => MX_BORDER_SOFT,
      vLineColor: () => MX_BORDER_FAINT,
      paddingTop: () => 3,
      paddingBottom: () => 3,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
  });

  if (stats) {
    content.push(
      mxStatStrip([
        { k: "Students", v: String(stats.count) },
        { k: "Class Average", v: mxFmt(stats.classAverage) },
        { k: "Highest", v: mxFmt(stats.highestAverage), color: MX_C.excellent },
        { k: "Lowest", v: mxFmt(stats.lowestAverage), color: MX_C.weak },
      ])
    );
  }

  const allSubjects = [
    ...subjects.general.map((s) => ({ ...s, _type: "General" })),
    ...subjects.professional.map((s) => ({ ...s, _type: "Professional" })),
    ...subjects.practical.map((s) => ({ ...s, _type: "Practical" })),
  ];
  const subjectsPerPage = selectedTerm === "annual" ? 2 : 3;

  for (let i = 0; i < allSubjects.length; i += subjectsPerPage) {
    const pageSubjects = allSubjects.slice(i, i + subjectsPerPage);
    content.push({ text: "", pageBreak: "before" });
    content.push(mxSectionBar(`${metadata.className}, Subject Details, ${termLabel}`));
    content.push({ text: "", margin: [0, 0, 0, 8] });

    pageSubjects.forEach((subj, subjIdx) => {
      if (subjIdx > 0) content.push({ text: "", margin: [0, 10, 0, 0] });

      content.push({
        text: `${subj._type}: ${subj.code}, ${subj.title} (Coef: ${subj.coef || "-"})`,
        bold: true,
        fontSize: 10,
        color: MX_C.primary,
        margin: [0, 0, 0, 4],
      });

      const subjHeaders = [mxHdrCell("S/N"), mxHdrCell("Student Name")];
      subjectSubcolumns.forEach((col) => {
        if (col.key !== "coef") subjHeaders.push(mxHdrCell(col.label));
      });

      const subjBody = [subjHeaders];
      sortedStudents.forEach((st, idx) => {
        const scores = st.subjects[subj.code] || {};
        const row = [
          { text: String(idx + 1), alignment: "center", fontSize: 8, color: MX_C.dark },
          { text: st.name, alignment: "left", fontSize: 8, color: MX_C.dark },
        ];
        subjectSubcolumns.forEach((col) => {
          if (col.key !== "coef") {
            const val = mxGetSubjectRaw(scores, col.key);
            const isFinal = col.key === "finalAvg";
            const isTermAvg = /^term\dAvg$/.test(col.key);
            row.push({
              text: mxFmt(val),
              alignment: "center",
              fontSize: isFinal ? 8.5 : 8,
              bold: isFinal || isTermAvg,
              color: mxValueColor(col.key, val, gradingScale),
            });
          }
        });
        subjBody.push(row);
      });

      const numCols = subjHeaders.length;
      const subjWidths = ["auto", "*", ...Array(numCols - 2).fill("auto")];

      content.push({
        table: { headerRows: 1, widths: subjWidths, body: subjBody },
        layout: {
          fillColor: (rowIndex) => (rowIndex > 0 && rowIndex % 2 === 0 ? MX_C.cardBg : null),
          hLineWidth: (i) => (i <= 1 ? 1 : 0.5),
          vLineWidth: () => 0.3,
          hLineColor: () => MX_BORDER_SOFT,
          vLineColor: () => MX_BORDER_FAINT,
          paddingTop: () => 2,
          paddingBottom: () => 2,
          paddingLeft: () => 3,
          paddingRight: () => 3,
        },
      });
    });
  }

  content.push({ text: "", margin: [0, 14, 0, 0] });
  content.push(
    mxFooterBoxes(
      gradingScale,
      { classMaster: administration?.classMaster, principal: administration?.principal },
      new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      { termLabel, studentCount: students.length }
    )
  );

  return withMatrixLogoWatermark(
    {
      compress: true,
      pageSize: "A4",
      pageOrientation: "portrait",
      pageMargins: [20, 20, 20, 20],
      defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.1 },
      content,
      info: { title: "Marks_Matrix_A4", author: "School Administration Tech Engine" },
    },
    logoBase64
  );
}

// leftCols: which student-identity columns repeat on this sheet. Every
// sheet carries S/N + Student Name so a reader flipping between pasted
// sheets never loses track of which row is whose; only the first sheet
// additionally carries Student ID (kept there once, not repeated, since
// it's the lookup key rather than something a reader scans row by row).
function mxBuildHeaderRowsForSlice(chunkCols, leftCols, includeTotals, totalsColumns) {
  const row0 = [];
  const row1 = [];
  const row2 = [];

  const leftCount = leftCols.length;
  const genSpan = chunkCols.filter((c) => c.type === "general").length;
  const proSpan = chunkCols.filter((c) => c.type === "professional").length;
  const praSpan = chunkCols.filter((c) => c.type === "practical").length;
  const totSpan = includeTotals ? totalsColumns?.length || 0 : 0;

  const pushGroup = (text, span) => {
    row0.push(mxHdrCell(text, { colSpan: span }));
    for (let i = 1; i < span; i++) row0.push({ text: "", fillColor: MX_C.primary });
  };

  if (leftCount > 0) pushGroup("Student Info", leftCount);
  if (genSpan > 0) pushGroup("General Subjects", genSpan);
  if (proSpan > 0) pushGroup("Professional Courses", proSpan);
  if (praSpan > 0) pushGroup("Practical Subjects", praSpan);
  if (totSpan > 0) pushGroup("Totals", totSpan);

  const leftLabels = { sn: "S/N", id: "Student ID", name: "Student Name" };
  leftCols.forEach((key) => row1.push(mxHdrCell(leftLabels[key])));

  let i = 0;
  while (i < chunkCols.length) {
    const subj = chunkCols[i];
    let span = 1;
    i++;
    while (i < chunkCols.length && chunkCols[i].code === subj.code) {
      span++;
      i++;
    }
    row1.push(mxHdrCell(`${subj.code}, ${subj.title}`, { colSpan: span }));
    for (let k = 1; k < span; k++) row1.push({ text: "", fillColor: MX_C.primary });
  }

  if (includeTotals && totalsColumns?.length) {
    totalsColumns.forEach((c) => row1.push(mxHdrCell(c.label)));
  }

  // Sub-column label tier (S1/S2/Coef/...) gets a lighter navy-tinted
  // band instead of the solid navy the two group/title rows above use;
  // three stacked solid-navy rows in a row would read as heavier than
  // this grid's own density calls for, this keeps it clearly part of the
  // same header block without the visual weight.
  const tintCell = (text, extra = {}) => ({
    text,
    style: "thSmall",
    alignment: "center",
    fillColor: MX_HEADER_TINT,
    color: MX_C.primary,
    ...extra,
  });
  leftCols.forEach(() => row2.push(tintCell("")));
  chunkCols.forEach((col) => {
    row2.push(tintCell(col.subLabel));
  });
  if (includeTotals && totalsColumns?.length) {
    for (let t = 0; t < totalsColumns.length; t++) row2.push(tintCell(""));
  }

  return [row0, row1, row2];
}

// "Wall poster", wide landscape grid, every student/subject on one sheet
// (chunked across pages by column groups when too wide for one page),
// meant to be printed large and posted on a notice board.
function buildMatrixWallDoc(prepared, selectedTerm, stats, logoBase64, gradingScale) {
  const { metadata, subjects, students, subjectSubcolumns, totalsColumns, administration } = prepared;

  const typedSubjects = [
    ...(subjects.general || []).map((s) => ({ ...s, _type: "general" })),
    ...(subjects.professional || []).map((s) => ({ ...s, _type: "professional" })),
    ...(subjects.practical || []).map((s) => ({ ...s, _type: "practical" })),
  ];

  const flatCols = [];
  (typedSubjects || []).forEach((s) => {
    (subjectSubcolumns || []).forEach((sub) => {
      flatCols.push({ code: s.code, title: s.title, type: s._type, subKey: sub.key, subLabel: sub.label });
    });
  });

  // MIDDLE/LAST budgets are lower than they used to be: every sheet now
  // repeats S/N + Student Name (see slices below), so sheets past the
  // first are no longer free of left-column overhead the way they were
  // when only the first sheet carried any student-identity columns.
  const MAX_SUBCOLS_FIRST = 20;
  const MAX_SUBCOLS_MIDDLE = 24;
  const MAX_SUBCOLS_LAST = Math.max(12, 20 - (totalsColumns?.length || 0));

  const chunks = [];
  if (!flatCols.length) {
    chunks.push([]);
  } else {
    let start = 0;
    const firstTake = Math.min(MAX_SUBCOLS_FIRST, flatCols.length);
    chunks.push(flatCols.slice(start, start + firstTake));
    start += firstTake;
    while (start < flatCols.length) {
      const remaining = flatCols.length - start;
      const isLast = remaining <= MAX_SUBCOLS_LAST;
      const take = isLast ? remaining : Math.min(MAX_SUBCOLS_MIDDLE, remaining);
      chunks.push(flatCols.slice(start, start + take));
      start += take;
    }
  }

  const lastIdx = Math.max(0, chunks.length - 1);
  // Every sheet repeats S/N + Student Name so a reader flipping between
  // pasted pages never loses track of whose row they're reading; Student
  // ID is only needed once, on the first sheet.
  const slices = chunks.map((cols, idx) => ({
    cols,
    leftCols: idx === 0 ? ["sn", "id", "name"] : ["sn", "name"],
    includeTotals: idx === lastIdx && (totalsColumns?.length || 0) > 0,
  }));

  const headersBySlice = slices.map((slice) =>
    mxBuildHeaderRowsForSlice(slice.cols, slice.leftCols, slice.includeTotals, totalsColumns)
  );

  const bodyRowsBySlice = slices.map(() => []);

  const leftCellFor = (key, i, st) => {
    if (key === "sn") return { text: String(i + 1), alignment: "center", noWrap: true, color: MX_C.dark };
    if (key === "id") return { text: String(st.studentId), alignment: "center", noWrap: true, color: MX_C.dark };
    return { text: st.name, alignment: "left", noWrap: true, color: MX_C.dark };
  };

  students.forEach((st, i) => {
    slices.forEach((slice, sIdx) => {
      const row = [];
      slice.leftCols.forEach((key) => row.push(leftCellFor(key, i, st)));
      slice.cols.forEach((col) => {
        const subjScores = st.subjects?.[col.code] || {};
        const raw = mxGetSubjectRaw(subjScores, col.subKey);
        const isFinal = col.subKey === "finalAvg";
        const cell = {
          text: mxFmt(raw),
          alignment: "center",
          noWrap: true,
          bold: isFinal,
          color: mxValueColor(col.subKey, raw, gradingScale),
        };
        if (String(col.subKey).toLowerCase() === "coef") cell.fillColor = MX_HEADER_TINT;
        row.push(cell);
      });
      if (slice.includeTotals) {
        (totalsColumns || []).forEach((c) => {
          const raw = mxGetTotalsRaw(st, c.key, selectedTerm);
          const isFinal = c.key === "annualAvg";
          row.push({
            text: mxFmt(raw),
            alignment: "center",
            noWrap: true,
            bold: isFinal,
            color: mxValueColor(c.key, raw, gradingScale),
          });
        });
      }
      bodyRowsBySlice[sIdx].push(row);
    });
  });

  const termLabel =
    selectedTerm === "term1" ? "First Term"
    : selectedTerm === "term2" ? "Second Term"
    : selectedTerm === "term3" ? "Third Term"
    : "Annual";

  const content = [];

  const layoutForSlice = (slice) => {
    const leftCount = slice.leftCols.length;
    const groupBreaks = new Set();
    if (slice.includeTotals) groupBreaks.add(leftCount + slice.cols.length);
    let span = 0;
    for (let i = 0; i < slice.cols.length; i++) {
      span++;
      const next = slice.cols[i + 1];
      if (!next || next.code !== slice.cols[i].code) groupBreaks.add(leftCount + span);
    }
    return {
      // Rows 0/1 (group + subject headers) are solid navy via mxHdrCell
      // already, no fillColor override needed at the layout level for
      // those; only row 2 (the tinted sub-label tier, also set by
      // mxHdrCell/tintCell already) and the zebra-striped body need one.
      fillColor: (rowIndex) => (rowIndex > 2 && (rowIndex - 3) % 2 === 0 ? MX_C.cardBg : null),
      hLineWidth: () => 0.4,
      vLineWidth: (i) => (groupBreaks.has(i) ? 1.5 : 0.3),
      hLineColor: () => MX_BORDER_SOFT,
      vLineColor: (i) => (groupBreaks.has(i) ? MX_C.gold : MX_BORDER_FAINT),
      paddingTop: () => 1,
      paddingBottom: () => 1,
      paddingLeft: () => 1,
      paddingRight: () => 1,
    };
  };

  const computeWidths = (slice) => {
    const widths = [];
    slice.leftCols.forEach((key) => widths.push("auto"));
    for (let k = 0; k < slice.cols.length; k++) widths.push("*");
    if (slice.includeTotals) {
      for (let t = 0; t < (totalsColumns?.length || 0); t++) widths.push("auto");
    }
    if (!widths.includes("*")) widths[widths.length - 1] = "*";
    return widths;
  };

  slices.forEach((slice, sIdx) => {
    const [groupRow, codeRow, subRow] = headersBySlice[sIdx];
    const widths = computeWidths(slice);
    const schoolTitle = `${(metadata.schoolName || "VOTECH S7 ACADEMY").toUpperCase()} - CLASS MASTER SHEET (${termLabel.toUpperCase()})`;
    const letterhead = mxWallLetterhead(schoolTitle, metadata, logoBase64);
    if (sIdx > 0) letterhead.pageBreak = "before";
    content.push(letterhead);
    content.push({
      columns: [
        { text: `Department: ${metadata.departmentName}`, bold: true, fontSize: 9, color: MX_C.dark },
        { text: `Class: ${metadata.className}`, bold: true, fontSize: 9, color: MX_C.primary, alignment: "center" },
        slices.length > 1
          ? { text: `Sheet ${sIdx + 1} of ${slices.length}`, bold: true, fontSize: 9, color: MX_C.dark, alignment: "right" }
          : { text: `Academic Year: ${metadata.academicYear}`, bold: true, fontSize: 9, color: MX_C.dark, alignment: "right" },
      ],
      margin: [0, 4, 0, 6],
    });
    if (sIdx === 0 && stats) {
      content.push(
        mxStatStrip([
          { k: "Students", v: String(stats.count) },
          { k: "Class Average", v: mxFmt(stats.classAverage) },
          { k: "Highest", v: mxFmt(stats.highestAverage), color: MX_C.excellent },
          { k: "Lowest", v: mxFmt(stats.lowestAverage), color: MX_C.weak },
        ])
      );
    }
    content.push({
      margin: [0, 0, 0, 0],
      table: { headerRows: 3, widths, body: [groupRow, codeRow, subRow, ...bodyRowsBySlice[sIdx]] },
      layout: layoutForSlice(slice),
    });
    if (sIdx === lastIdx) {
      content.push({ text: "", margin: [0, 10, 0, 0] });
      content.push(
        mxFooterBoxes(
          gradingScale,
          { classMaster: administration?.classMaster, principal: administration?.principal },
          new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
          { termLabel, studentCount: students.length }
        )
      );
    }
  });

  return withMatrixLogoWatermark(
    {
      compress: true,
      pageSize: { width: 841.89, height: 595.28 },
      pageOrientation: "landscape",
      pageMargins: [10, 10, 10, 10],
      defaultStyle: { font: "Roboto", fontSize: 8.5, lineHeight: 1.12 },
      content,
      styles: {
        thCenter: { bold: true, alignment: "center" },
        thSmall: { bold: true, fontSize: 8, alignment: "center" },
      },
      info: { title: "Marks_Matrix_Wall", author: "School Administration Tech Engine" },
    },
    logoBase64
  );
}

const mxSanitize = (str = "") => String(str).replace(/[^\w]+/g, "_");

const downloadMarksMatrixPdf = catchAsync(async (req, res, next) => {
  const {
    academicYearId,
    departmentId,
    classId,
    term = "annual",
    format = "wall",
  } = req.query;

  let finalCards, meta, gradingScale;
  try {
    ({ finalCards, meta, gradingScale } = await buildMarksMatrixCards({
      academicYearId,
      departmentId,
      classId,
    }));
  } catch (err) {
    return next(err);
  }

  const prepared = prepareMatrixPdfData(finalCards, term, meta);
  if (!prepared) {
    return next(new AppError("No data available to build this matrix.", StatusCodes.NOT_FOUND));
  }
  const stats = computeMatrixStats(prepared.students, term);
  const logoBase64 = loadLogoBase64();

  const docDefinition =
    format === "a4"
      ? buildMatrixA4Doc(prepared, term, stats, logoBase64, gradingScale)
      : buildMatrixWallDoc(prepared, term, stats, logoBase64, gradingScale);

  const filename = `Marks_Matrix_${format === "a4" ? "A4" : "Wall"}_${mxSanitize(meta.departmentName)}_${mxSanitize(meta.className)}_${mxSanitize(meta.academicYear)}_${mxSanitize(term)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  try {
    const doc = printer.createPdfKitDocument(docDefinition);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    if (!res.headersSent) {
      return next(new AppError("PDF generation failed: " + (err.message || ""), StatusCodes.INTERNAL_SERVER_ERROR));
    }
  }
});

module.exports = {
  getMarksMatrix,
  getMarksCoverage,
  downloadCoveragePdf,
  downloadMarksMatrixPdf,
  // Reused by teacherDashboard.controller.js's "marks I still owe" card,
  // scoped to one teacher via the optional teacherId filter added above.
  computeCoverage,
};
