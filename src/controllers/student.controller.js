const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const models = require("../models/index.model");
const CRUD = require("../utils/Crud");
const AppError = require("../utils/AppError");
const appResponder = require("../utils/appResponder");
const catchAsync = require("../utils/catchAsync");
const { sequelize } = require("../db");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination.util");
const { uploadSingleFileToFTP } = require("../services/fileStorage.service");
const { printer, loadLogoBase64, sanitize } = require("./reportCardPdfGenerator");

const tableName = models.Student.getTableName();

// Converges student photo uploads onto the one FTP path everything else
// in this session already uses (uploadSingleFileToFTP), rather than the
// legacy route's separate ftp-service.js client. That function only
// takes a local file path (it streams from disk, not memory), so a
// multer memory-storage buffer gets written to a throwaway temp file
// first, then cleaned up in `finally` regardless of outcome.
async function uploadStudentPhoto(file) {
  if (!file) return null;
  const ext = path.extname(file.originalname || "") || ".jpg";
  const tempPath = path.join(os.tmpdir(), `student-photo-${crypto.randomBytes(6).toString("hex")}${ext}`);
  await fs.promises.writeFile(tempPath, file.buffer);
  try {
    const remoteFileName = `students/photos/${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    return await uploadSingleFileToFTP(tempPath, remoteFileName, {});
  } finally {
    fs.unlink(tempPath, () => {});
  }
}

let CRUDStudentsModel = new CRUD(models.Student);

async function initStudents() {
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes(tableName)) {
      await models.Student.sync({ force: false });
    }
    CRUDStudentsModel = new CRUD(models.Student);
  } catch (err) {
    throw err;
  }
}

initStudents();

const readOneStudent = catchAsync(async (req, res, next) => {
  await CRUDStudentsModel.readOne(req.params.id, res, [
    {
      association: models.Student.associations.department_choices,
      include: [{ association: models.StudentDepartmentChoice.associations.department }],
    },
  ]);
});

// Server-side search/filter/paginate, same contract as report-card
// sessions and promotion history (page, limit, search, sortBy, sortDir).
// Status defaults to nothing (everyone) if the caller doesn't ask —
// the rebuilt Students page is the one that opts into ?status=active,
// nothing else changes for any other consumer of this route.
const STUDENT_SORT_FIELDS = {
  full_name: "full_name",
  student_id: "student_id",
  registration_date: "registration_date",
  status: "status",
};

// Shared by the list endpoint and the stats endpoint below, so "what
// you're currently looking at" and "the numbers on that view" can never
// silently drift apart from having two independently-maintained copies
// of the same filter logic.
async function buildStudentWhere(query) {
  const { search = "", status, class_id, department_id, academic_year_id } = query;
  const where = {};
  if (status) where.status = status;
  if (class_id) where.class_id = class_id;
  if (academic_year_id) where.academic_year_id = academic_year_id;

  // Department filtering deliberately goes through class_id, not
  // students.specialty_id — checked directly against real data, only
  // ~22% of students (471/2126) have specialty_id populated, while
  // class_id is set on every student and class.department_id is
  // required (never null). specialty_id is a separate, inconsistently
  // used field (fee-schedule bookkeeping on the registration form), not
  // a reliable source of truth for "what department is this student in."
  if (department_id) {
    const classesInDept = await models.Class.findAll({
      where: { department_id },
      attributes: ["id"],
      raw: true,
    });
    const classIds = classesInDept.map((c) => c.id);
    // No classes in this department at all — force an empty result
    // instead of silently ignoring the filter (Op.in: [] correctly
    // matches nothing in Sequelize/Postgres).
    where.class_id = class_id
      ? classIds.includes(Number(class_id))
        ? class_id
        : -1
      : { [Op.in]: classIds };
  }

  const trimmedSearch = String(search || "").trim();
  if (trimmedSearch) {
    where[Op.or] = [
      { full_name: { [Op.iLike]: `%${trimmedSearch}%` } },
      { student_id: { [Op.iLike]: `%${trimmedSearch}%` } },
    ];
  }

  return where;
}

const readAllStudents = catchAsync(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
  const sortBy = STUDENT_SORT_FIELDS[req.query.sortBy] || "full_name";
  const sortDir = String(req.query.sortDir).toLowerCase() === "desc" ? "DESC" : "ASC";
  const where = await buildStudentWhere(req.query);

  const { rows, count } = await models.Student.findAndCountAll({
    where,
    order: [[sortBy, sortDir]],
    limit,
    offset,
    include: [
      { association: models.Student.associations.Class },
      { association: models.Student.associations.specialties },
    ],
  });

  appResponder(
    StatusCodes.OK,
    { students: rows, pagination: buildPaginationMeta(page, limit, count) },
    res
  );
});

// Same formula the old frontend used client-side
// ({year}-VOT-{first2}{last2}-{seq}), moved server-side because seq was
// literally "however many students happened to be loaded in this
// browser tab's list right now" — provably wrong (the real DB has
// several different students sharing the same seq, from being
// registered in the same stale-list session). Here seq comes from a
// real count at generation time, and on a unique-constraint collision
// (another registration landed between the count and the insert) we
// just regenerate with the next number and retry, instead of surfacing
// a raw DB error to the admin.
function buildStudentIdCandidate(fullName, registrationDate, seq) {
  const [first, ...rest] = String(fullName || "").trim().split(/\s+/);
  const last = rest.length ? rest[rest.length - 1] : "";
  const year = registrationDate
    ? String(new Date(registrationDate).getFullYear()).slice(2, 4)
    : String(new Date().getFullYear()).slice(2, 4);
  const firstPart = (first || "").slice(0, 2).toUpperCase();
  const lastPart = (last || "").slice(-2).toUpperCase();
  return `${year}-VOT-${firstPart}${lastPart}-${String(seq).padStart(3, "0")}`;
}

async function generateAndInsertStudent(data, transaction) {
  const baseCount = await models.Student.count({ paranoid: false, transaction });
  let seq = baseCount + 1;

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = buildStudentIdCandidate(data.full_name, data.registration_date, seq);
    try {
      return await models.Student.create(
        { ...data, student_id: candidate },
        { transaction }
      );
    } catch (err) {
      const isUniqueViolation =
        err.name === "SequelizeUniqueConstraintError" &&
        err.errors?.some((e) => e.path === "student_id");
      if (!isUniqueViolation || attempt === 19) throw err;
      seq += 1;
    }
  }
}

// Six-choice requirement — mandatory and duplicate-checked whenever the
// target class is flagged is_orientation. `choices` is an array of
// department ids in rank order (index 0 = rank 1, the top choice).
// Replaces (not merges) any existing choices for the student, so an edit
// that re-ranks is a clean overwrite, not an accumulation.
async function applyDepartmentChoices(studentId, choices, transaction) {
  if (!Array.isArray(choices) || choices.length !== 6) {
    throw new AppError(
      "An orientation-class student needs exactly six ranked department choices.",
      StatusCodes.BAD_REQUEST
    );
  }
  const distinct = new Set(choices.map((id) => Number(id)));
  if (distinct.size !== 6 || choices.some((id) => !Number.isInteger(Number(id)))) {
    throw new AppError(
      "The six department choices must all be different departments.",
      StatusCodes.BAD_REQUEST
    );
  }

  const departments = await models.Specialty.findAll({
    where: { id: { [Op.in]: choices.map(Number) } },
    attributes: ["id"],
    transaction,
  });
  if (departments.length !== 6) {
    throw new AppError(
      "One or more chosen departments were not found.",
      StatusCodes.BAD_REQUEST
    );
  }

  await models.StudentDepartmentChoice.destroy({
    where: { student_id: studentId },
    transaction,
  });
  await models.StudentDepartmentChoice.bulkCreate(
    choices.map((departmentId, idx) => ({
      student_id: studentId,
      department_id: Number(departmentId),
      rank: idx + 1,
    })),
    { transaction }
  );
}

// Fields the create/update endpoints accept directly — matches the
// Student model 1:1, no camelCase translation layer, this is a fresh
// endpoint for the fresh Students page, not required to match the
// legacy route's field names.
const WRITABLE_FIELDS = [
  "full_name",
  "sex",
  "date_of_birth",
  "place_of_birth",
  "father_name",
  "mother_name",
  "class_id",
  "academic_year_id",
  "specialty_id",
  "guardian_contact",
  "mother_contact",
  "photo_url",
  "registration_date",
  "status",
];

function pickWritableFields(body) {
  const data = {};
  for (const field of WRITABLE_FIELDS) {
    if (field in body) data[field] = body[field];
  }
  return data;
}

// multipart/form-data (needed whenever a photo comes along) can only
// carry flat string fields, so an array like department_choices arrives
// JSON-stringified by the frontend and needs parsing back out. A plain
// JSON request (no photo) already has it as a real array, left alone.
function parseDepartmentChoices(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return raw;
}

const createStudent = catchAsync(async (req, res, next) => {
  const data = pickWritableFields(req.body);
  const department_choices = parseDepartmentChoices(req.body.department_choices);
  if (req.file) data.photo_url = await uploadStudentPhoto(req.file);

  if (!data.full_name || !data.sex || !data.date_of_birth || !data.place_of_birth) {
    return next(
      new AppError(
        "full_name, sex, date_of_birth, and place_of_birth are required.",
        StatusCodes.BAD_REQUEST
      )
    );
  }
  if (!data.class_id || !data.academic_year_id) {
    return next(
      new AppError("class_id and academic_year_id are required.", StatusCodes.BAD_REQUEST)
    );
  }
  if (!data.registration_date) data.registration_date = new Date();

  const targetClass = await models.Class.findByPk(data.class_id);
  if (!targetClass) {
    return next(new AppError("Class not found.", StatusCodes.NOT_FOUND));
  }
  if (targetClass.is_orientation && (!department_choices || department_choices.length === 0)) {
    return next(
      new AppError(
        `${targetClass.name} is an orientation class — six ranked department choices are required at registration.`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const t = await sequelize.transaction();
  try {
    const student = await generateAndInsertStudent(data, t);

    if (targetClass.is_orientation) {
      await applyDepartmentChoices(student.id, department_choices, t);
    }

    await t.commit();

    await logChanges(tableName, student.id, ChangeTypes.create, req.user).catch(() => {});

    const withChoices = await models.Student.findByPk(student.id, {
      include: [
        {
          association: models.Student.associations.department_choices,
          include: [{ association: models.StudentDepartmentChoice.associations.department }],
        },
      ],
    });
    appResponder(StatusCodes.CREATED, withChoices, res);
  } catch (err) {
    await t.rollback();
    throw err;
  }
});

const updateStudent = catchAsync(async (req, res, next) => {
  const student = await models.Student.findByPk(req.params.id);
  if (!student) {
    return next(new AppError("Student not found.", StatusCodes.NOT_FOUND));
  }

  const data = pickWritableFields(req.body);
  // student_id is generated once at registration and never changes —
  // silently ignore any client-supplied value rather than trust it.
  delete data.student_id;
  if (req.file) data.photo_url = await uploadStudentPhoto(req.file);

  const department_choices = parseDepartmentChoices(req.body.department_choices);
  const targetClassId = data.class_id || student.class_id;
  const targetClass = await models.Class.findByPk(targetClassId);
  if (!targetClass) {
    return next(new AppError("Class not found.", StatusCodes.NOT_FOUND));
  }

  const existingChoiceCount = await models.StudentDepartmentChoice.count({
    where: { student_id: student.id },
  });
  const mustHaveChoices = targetClass.is_orientation;
  const isChangingChoices = Array.isArray(department_choices);

  if (mustHaveChoices && existingChoiceCount === 0 && !isChangingChoices) {
    return next(
      new AppError(
        `${targetClass.name} is an orientation class — six ranked department choices are required.`,
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const t = await sequelize.transaction();
  try {
    const existingPlain = student.get({ plain: true });
    await student.update(data, { transaction: t });

    if (isChangingChoices) {
      await applyDepartmentChoices(student.id, department_choices, t);
    }

    await t.commit();

    const fieldsChanged = {};
    for (const key of Object.keys(data)) {
      if (String(existingPlain[key]) !== String(data[key])) {
        fieldsChanged[key] = { before: existingPlain[key], after: data[key] };
      }
    }
    if (Object.keys(fieldsChanged).length > 0) {
      await logChanges(tableName, student.id, ChangeTypes.update, req.user, fieldsChanged).catch(
        () => {}
      );
    }

    const withChoices = await models.Student.findByPk(student.id, {
      include: [
        {
          association: models.Student.associations.department_choices,
          include: [{ association: models.StudentDepartmentChoice.associations.department }],
        },
      ],
    });
    appResponder(StatusCodes.OK, withChoices, res);
  } catch (err) {
    await t.rollback();
    throw err;
  }
});

// Soft delete (the model is paranoid: true) — recoverable, matches the
// same "don't let a wrong action destroy real data" posture as
// everything else built this session.
const deleteStudent = catchAsync(async (req, res, next) => {
  await CRUDStudentsModel.delete(req.params.id, res, req);
});

// ─── Orientation-choice backfill ───────────────────────────────────
//
// For the hundreds of students already enrolled in orientation classes
// before this feature existed — asking them to rank all six departments
// now, mid-year, isn't realistic (per explicit product direction). This
// tool sets only rank 1 (the department itself), which is all
// promotion's destination restriction actually needs as a baseline; an
// admin can still open a student's full edit form later to complete
// ranks 2-6 if they want the richer restriction. Registration itself
// still requires the full six — this is a distinct, narrower flow.

const listOrientationStudents = catchAsync(async (req, res) => {
  const { class_id } = req.query;

  const classWhere = { is_orientation: true };
  if (class_id) classWhere.id = class_id;
  const orientationClasses = await models.Class.findAll({
    where: classWhere,
    attributes: ["id"],
  });
  const classIds = orientationClasses.map((c) => c.id);
  if (classIds.length === 0) {
    return appResponder(StatusCodes.OK, [], res);
  }

  const students = await models.Student.findAll({
    where: { status: "active", class_id: { [Op.in]: classIds } },
    attributes: ["id", "full_name", "student_id", "class_id"],
    include: [
      { association: models.Student.associations.Class, attributes: ["id", "name"] },
      {
        association: models.Student.associations.department_choices,
        where: { rank: 1 },
        required: false,
        include: [
          { association: models.StudentDepartmentChoice.associations.department, attributes: ["id", "name"] },
        ],
      },
    ],
    order: [["full_name", "ASC"]],
  });

  appResponder(StatusCodes.OK, students, res);
});

const bulkSetDepartmentChoice = catchAsync(async (req, res, next) => {
  const { student_ids, department_id } = req.body;
  if (!Array.isArray(student_ids) || student_ids.length === 0 || !department_id) {
    return next(
      new AppError("student_ids and department_id are required.", StatusCodes.BAD_REQUEST)
    );
  }

  const department = await models.Specialty.findByPk(department_id);
  if (!department) {
    return next(new AppError("Department not found.", StatusCodes.NOT_FOUND));
  }

  const students = await models.Student.findAll({
    where: { id: { [Op.in]: student_ids } },
    include: [{ association: models.Student.associations.Class }],
  });
  const foundIds = new Set(students.map((s) => s.id));

  const applied = [];
  const skipped = [];

  for (const requestedId of student_ids) {
    if (!foundIds.has(Number(requestedId))) {
      skipped.push({ student_id: requestedId, name: null, reason: "Student not found." });
    }
  }

  for (const student of students) {
    if (!student.Class?.is_orientation) {
      skipped.push({
        student_id: student.id,
        name: student.full_name,
        reason: "Not currently in an orientation class.",
      });
      continue;
    }

    // Only rank 1 is ever touched here — if this department is already
    // recorded at a different rank for this student (they went through
    // full registration, or a previous backfill+edit), overwriting rank
    // 1 alone would violate the (student_id, department_id) uniqueness
    // constraint and leave their ranking inconsistent. Skip with a
    // reason rather than silently corrupt it.
    const conflictingRank = await models.StudentDepartmentChoice.findOne({
      where: { student_id: student.id, department_id, rank: { [Op.ne]: 1 } },
    });
    if (conflictingRank) {
      skipped.push({
        student_id: student.id,
        name: student.full_name,
        reason: `${department.name} is already ranked #${conflictingRank.rank} for this student.`,
      });
      continue;
    }

    const t = await sequelize.transaction();
    try {
      await models.StudentDepartmentChoice.destroy({
        where: { student_id: student.id, rank: 1 },
        transaction: t,
      });
      await models.StudentDepartmentChoice.create(
        { student_id: student.id, department_id, rank: 1 },
        { transaction: t }
      );
      await t.commit();
      applied.push({ student_id: student.id, name: student.full_name });
    } catch (err) {
      await t.rollback();
      skipped.push({ student_id: student.id, name: student.full_name, reason: "Failed to save." });
    }
  }

  appResponder(StatusCodes.OK, { applied, skipped }, res);
});

// ─── Class List PDF ────────────────────────────────────────────────
//
// Moved server-side (pdfmake) to match the report card's visual identity
// — same navy (#204080), same faint centered logo watermark, same
// printer/font setup — reused directly from reportCardPdfGenerator.js
// rather than re-declared here. The six original columns (S/N, Student
// ID, Full Name, Sex, Date of Birth, Father's Contact) are unchanged for
// every class; an orientation class additionally appends its students'
// six ranked department choices and switches to landscape, a regular
// class's list is completely untouched by this feature.

const CLASS_LIST_C = {
  primary: "#204080",
  dark: "#333333",
  light: "#666666",
  white: "#FFFFFF",
  rowLine: "#cbd5e0",
};

function buildClassListDoc({ className, departmentName, academicYearName, students, isOrientation }) {
  const logoBase64 = loadLogoBase64();

  const baseHeaders = ["S/N", "Student ID", "Full Name", "Sex", "Date of Birth", "Father's Contact"];
  const choiceHeaders = isOrientation ? [1, 2, 3, 4, 5, 6].map((n) => `Choice ${n}`) : [];
  const headers = [...baseHeaders, ...choiceHeaders];

  const headerRow = headers.map((h) => ({
    text: h,
    bold: true,
    fontSize: 8,
    color: CLASS_LIST_C.white,
    fillColor: CLASS_LIST_C.primary,
  }));

  const bodyRows = students.map((s, idx) => {
    const row = [
      String(idx + 1),
      s.student_id || "",
      s.full_name || "",
      s.sex || "",
      s.date_of_birth ? new Date(s.date_of_birth).toLocaleDateString() : "",
      s.guardian_contact || "",
    ];
    if (isOrientation) {
      const byRank = new Map(
        (s.department_choices || []).map((c) => [c.rank, c.department?.name || ""])
      );
      for (let r = 1; r <= 6; r++) row.push(byRank.get(r) || "");
    }
    return row.map((v) => ({ text: String(v), fontSize: 7.5, color: CLASS_LIST_C.dark }));
  });

  const widths = isOrientation
    ? [22, 68, 110, 26, 58, 66, 56, 56, 56, 56, 56, 56]
    : [28, 90, 170, 40, 80, 100];

  return {
    pageSize: "A4",
    pageOrientation: isOrientation ? "landscape" : "portrait",
    pageMargins: [24, 20, 24, 20],
    defaultStyle: { font: "Roboto", fontSize: 8 },

    ...(logoBase64 ? { images: { reportLogo: logoBase64 } } : {}),
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

    content: [
      logoBase64
        ? { image: "reportLogo", width: 48, height: 48, alignment: "center", margin: [0, 0, 0, 4] }
        : null,
      { text: "VOTECH(S7) ACADEMY", bold: true, fontSize: 16, color: CLASS_LIST_C.primary, alignment: "center" },
      { text: "Class List", fontSize: 12, color: CLASS_LIST_C.dark, alignment: "center", margin: [0, 2, 0, 2] },
      { text: className, fontSize: 11, bold: true, color: CLASS_LIST_C.primary, alignment: "center" },
      {
        text: `${departmentName} · ${academicYearName}`,
        fontSize: 9,
        color: CLASS_LIST_C.light,
        alignment: "center",
      },
      {
        text: `Generated on ${new Date().toLocaleDateString()} · Total Students: ${students.length}`,
        fontSize: 8,
        color: CLASS_LIST_C.light,
        alignment: "center",
        margin: [0, 2, 0, 10],
      },
      {
        table: { headerRows: 1, widths, body: [headerRow, ...bodyRows] },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => CLASS_LIST_C.primary,
          vLineColor: () => CLASS_LIST_C.rowLine,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ].filter(Boolean),

    info: {
      title: `Class List – ${className}`,
      author: "Izzy Tech Team",
      subject: `Class List for ${className}`,
    },
  };
}

const classListPdf = catchAsync(async (req, res, next) => {
  const { classId } = req.params;
  const { disposition = "attachment" } = req.query;

  const studentClass = await models.Class.findByPk(classId, {
    include: [{ association: models.Class.associations.department }],
  });
  if (!studentClass) {
    return next(new AppError("Class not found.", StatusCodes.NOT_FOUND));
  }

  const academicYear = await models.AcademicYear.findOne({ where: { status: "active" } });

  const students = await models.Student.findAll({
    where: { class_id: classId, status: "active" },
    order: [["full_name", "ASC"]],
    include: studentClass.is_orientation
      ? [
          {
            association: models.Student.associations.department_choices,
            include: [
              { association: models.StudentDepartmentChoice.associations.department },
            ],
          },
        ]
      : [],
  });

  if (!students.length) {
    return next(new AppError(`No active students found in ${studentClass.name}.`, StatusCodes.NOT_FOUND));
  }

  const docDefinition = buildClassListDoc({
    className: studentClass.name,
    departmentName: studentClass.department?.name || "",
    academicYearName: academicYear?.name || "",
    students: students.map((s) => s.get({ plain: true })),
    isOrientation: studentClass.is_orientation,
  });

  const safeDisposition = disposition === "inline" ? "inline" : "attachment";
  const filename = `Class_List_${sanitize(studentClass.name)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${safeDisposition}; filename="${filename}"`);

  try {
    const doc = printer.createPdfKitDocument(docDefinition);
    doc.on("error", (err) => {
      if (!res.headersSent) next(err);
    });
    doc.pipe(res);
    doc.end();
  } catch (err) {
    return next(
      new AppError(
        "Class list PDF generation failed: " + (err.message || ""),
        StatusCodes.INTERNAL_SERVER_ERROR
      )
    );
  }
});

module.exports = {
  readOneStudent,
  readAllStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  listOrientationStudents,
  bulkSetDepartmentChoice,
  classListPdf,
};
