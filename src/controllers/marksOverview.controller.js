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
const { printer, loadLogoBase64 } = require("./reportCardPdfGenerator");
const { getOrCreateSettings } = require("./schoolSettings.controller");
const { resolveClassMasterName } = require("../utils/classMaster.util");

const C = {
  navy: "#204080",
  gold: "#d4af37",
  slate: "#4b5563",
  bgHeader: "#eaf0fb",
  rowAlt: "#f7f8fa",
  white: "#ffffff",
  good: "#1f7a4d",
  warn: "#b7791f",
  bad: "#c0392b",
};

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

const getMarksMatrix = catchAsync(async (req, res, next) => {
  const { academicYearId, departmentId, classId } = req.query;
  if (!academicYearId || !classId) {
    return next(
      new AppError("academicYearId and classId are required", StatusCodes.BAD_REQUEST)
    );
  }

  const [academicYear, studentClass, classSubjects, settings] = await Promise.all([
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
    getOrCreateSettings(),
  ]);

  if (!academicYear) return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  if (!studentClass) return next(new AppError("Class not found", StatusCodes.NOT_FOUND));

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
    return next(
      new AppError(`No students found for ${studentClass.name} in this academic year.`, StatusCodes.NOT_FOUND)
    );
  }

  // De-dup by subject code — a subject can appear once per department on
  // an orientation class when no departmentId filter is supplied.
  const subjectDefs = [];
  const seenCodes = new Set();
  for (const cs of classSubjects) {
    if (!cs.subject || seenCodes.has(cs.subject.code)) continue;
    seenCodes.add(cs.subject.code);
    subjectDefs.push({
      code: cs.subject.code,
      title: cs.subject.name,
      coef: cs.subject.coefficient,
      category:
        cs.subject.category === "professional"
          ? "professional"
          : cs.subject.category === "general"
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

  const classMasterName = await resolveClassMasterName(classId, academicYearId);
  const cards = marks.length
    ? buildReportCardsFromMarks(marks, classMasterName, "annual", settings.principal_name, settings)
    : [];
  const cardsByStudent = new Map(cards.map((c) => [c.student.id, c]));

  const meta = {
    schoolName: settings.school_name,
    className: studentClass.name,
    departmentName: studentClass.department?.name || "",
    academicYear: academicYear.name,
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

function statusColor(status) {
  if (status === "complete") return C.good;
  if (status === "partial") return C.warn;
  return C.bad;
}

function statusLabel(status) {
  if (status === "complete") return "Complete";
  if (status === "partial") return "Partial";
  return "Not Started";
}

function buildCoveragePdfDoc({ summary, teacherRows }, meta, logoBase64) {
  const content = [];

  if (logoBase64) {
    content.push({ image: "reportLogo", width: 55, height: 55, alignment: "center", margin: [0, 0, 0, 6] });
  }
  content.push(
    {
      text: "MARKS COMPLETION STATUS",
      fontSize: 15,
      bold: true,
      color: C.navy,
      alignment: "center",
      margin: [0, 0, 0, 2],
    },
    {
      text: `${summary.sequenceLabel} · ${meta.academicYearName} · as of ${meta.generatedAt}`,
      fontSize: 9,
      italics: true,
      color: C.slate,
      alignment: "center",
      margin: [0, 0, 0, 12],
    },
    {
      columns: [
        { text: `${summary.complete}`, bold: true, fontSize: 16, color: C.good, alignment: "center" },
        { text: `${summary.partial}`, bold: true, fontSize: 16, color: C.warn, alignment: "center" },
        { text: `${summary.notStarted}`, bold: true, fontSize: 16, color: C.bad, alignment: "center" },
      ],
      margin: [0, 0, 0, 2],
    },
    {
      columns: [
        { text: "Complete", fontSize: 8, color: C.slate, alignment: "center" },
        { text: "Partial", fontSize: 8, color: C.slate, alignment: "center" },
        { text: "Not Started", fontSize: 8, color: C.slate, alignment: "center" },
      ],
      margin: [0, 0, 0, 16],
    }
  );

  for (const t of teacherRows) {
    content.push({
      text: t.teacherName,
      fontSize: 11,
      bold: true,
      color: C.navy,
      fillColor: C.bgHeader,
      margin: [4, 4, 4, 4],
    });

    const rows = t.assignments.map((a) => {
      const names = a.missingStudents.slice(0, MAX_NAMES_LISTED).map((s) => s.name + s.note);
      const extra = a.missingStudents.length - names.length;
      const detail =
        a.status === "complete"
          ? "All marks entered"
          : a.status === "not_started"
          ? `Not started — ${a.rosterCount} students`
          : names.join(", ") + (extra > 0 ? `, +${extra} more` : "");
      return [
        { text: `${a.className} — ${a.subjectTitle}`, fontSize: 8.5, color: C.slate },
        { text: statusLabel(a.status), fontSize: 8.5, bold: true, color: statusColor(a.status), alignment: "center" },
        { text: detail, fontSize: 8, color: a.status === "complete" ? C.good : C.bad },
      ];
    });

    content.push({
      table: { widths: [140, 70, "*"], body: rows },
      layout: {
        hLineWidth: () => 0.4,
        vLineWidth: () => 0,
        hLineColor: () => "#e2e8f0",
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 10],
    });
  }

  return {
    pageSize: "A4",
    pageMargins: [30, 30, 30, 30],
    content,
    defaultStyle: { font: "Roboto", fontSize: 8.5 },
    ...(logoBase64 ? { images: { reportLogo: logoBase64 } } : {}),
    footer: (currentPage, pageCount) => ({
      text: `Page ${currentPage} of ${pageCount}`,
      fontSize: 7,
      color: C.slate,
      alignment: "center",
    }),
    info: { title: "Marks_Completion_Status", author: "School Administration Tech Engine" },
  };
}

const downloadCoveragePdf = catchAsync(async (req, res, next) => {
  const { academicYearId, sequenceId, termId } = req.query;
  let data, academicYear;
  try {
    [data, academicYear] = await Promise.all([
      computeCoverage({ academicYearId, sequenceId, termId }),
      models.AcademicYear.findByPk(academicYearId),
    ]);
  } catch (err) {
    return next(err);
  }

  const meta = {
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

module.exports = {
  getMarksMatrix,
  getMarksCoverage,
  downloadCoveragePdf,
  // Reused by teacherDashboard.controller.js's "marks I still owe" card,
  // scoped to one teacher via the optional teacherId filter added above.
  computeCoverage,
};
