"use strict";

// Resolvers for the reference data that documents used to read live, and
// that a later edit could therefore rewrite retroactively on every past
// document. Each one answers "what was this in YEAR X", falling back to
// the live value only when that year has no record of its own (a year that
// predates these tables existing) — a best-effort guess rather than a
// blank, matching how classMaster.util.js already handles the same case.

// Map of subject_id -> { coefficient, category } for one year. Subjects
// with no row for that year are simply absent, callers keep the live value.
async function getSubjectSettingsForYear(academicYearId, subjectIds = null) {
  const models = require("../models/index.model");
  if (!academicYearId) return new Map();

  const where = { academic_year_id: academicYearId };
  if (Array.isArray(subjectIds) && subjectIds.length) {
    where.subject_id = subjectIds;
  }

  const rows = await models.SubjectYearSetting.findAll({
    where,
    attributes: ["subject_id", "coefficient", "category"],
    raw: true,
  });

  return new Map(
    rows.map((r) => [r.subject_id, { coefficient: r.coefficient, category: r.category }])
  );
}

// Overlays a year's coefficient/category onto marks already fetched with
// their subject include, in place. Called once right after the fetch so
// every downstream consumer (average/rank/remark computation, the PDF
// layout, the matrix) sees the year's values without each needing to know
// this table exists.
//
// Marks are fetched raw+nest for memory reasons, so mark.subject is a
// plain object and can be mutated directly. The Mark row's own subject_id
// is used rather than anything on the nested object, which carries only
// the attributes the include selected.
async function applySubjectSettingsForYear(marks, academicYearId) {
  if (!Array.isArray(marks) || marks.length === 0) return marks;

  const subjectIds = [...new Set(marks.map((m) => m.subject_id).filter(Boolean))];
  const settings = await getSubjectSettingsForYear(academicYearId, subjectIds);
  if (settings.size === 0) return marks;

  for (const mark of marks) {
    const forYear = settings.get(mark.subject_id);
    if (forYear && mark.subject) {
      mark.subject.coefficient = forYear.coefficient;
      mark.subject.category = forYear.category;
    }
  }
  return marks;
}

// What a class was called, and which department it sat in, during a
// specific year. Returns the live class values when that year has no row.
async function resolveClassForYear(classId, academicYearId) {
  const models = require("../models/index.model");

  if (academicYearId) {
    const scoped = await models.ClassYearSetting.findOne({
      where: { class_id: classId, academic_year_id: academicYearId },
      include: [{ model: models.Specialty, as: "department", attributes: ["id", "name"] }],
    });
    if (scoped) {
      return {
        name: scoped.name,
        department_id: scoped.department_id,
        department_name: scoped.department?.name || "",
      };
    }
  }

  const cls = await models.Class.findByPk(classId, {
    include: [{ model: models.Specialty, as: "department", attributes: ["id", "name"] }],
  });
  return {
    name: cls?.name || "",
    department_id: cls?.department_id || null,
    department_name: cls?.department?.name || "",
  };
}

// School identity as it stood in a specific year, merged over the single
// settings row so the non-year-scoped fields (contact details, motto) come
// along too and callers keep using one object.
async function resolveSchoolSettingsForYear(academicYearId) {
  const models = require("../models/index.model");
  const { getOrCreateSettings } = require("../controllers/schoolSettings.controller");

  const base = await getOrCreateSettings();
  const plain = typeof base.get === "function" ? base.get({ plain: true }) : { ...base };

  if (!academicYearId) return plain;

  const scoped = await models.SchoolSettingYear.findOne({
    where: { academic_year_id: academicYearId },
    raw: true,
  });
  if (!scoped) return plain;

  return {
    ...plain,
    school_name: scoped.school_name || plain.school_name,
    principal_name: scoped.principal_name || plain.principal_name,
  };
}

// Mirrors classes.class_master_id's sync behaviour: whenever the live
// value on the permanent record changes, record it against the active year
// too, so this year's history is being written as it happens rather than
// only from the point someone opens a year-scoped editor. Never touches a
// non-active year — an archived year's record is changed only through its
// own editor, under a grant.
async function syncActiveYearSetting(model, where, values) {
  const models = require("../models/index.model");
  const activeYear = await models.AcademicYear.findOne({ where: { status: "active" } });
  if (!activeYear) return null;

  const [row, created] = await model.findOrCreate({
    where: { ...where, academic_year_id: activeYear.id },
    defaults: { ...where, academic_year_id: activeYear.id, ...values },
    skipYearLockCheck: true,
  });

  if (!created) {
    const changed = Object.entries(values).some(([key, value]) => row[key] !== value);
    if (changed) await row.update(values, { skipYearLockCheck: true });
  }
  return row;
}

module.exports = {
  getSubjectSettingsForYear,
  applySubjectSettingsForYear,
  resolveClassForYear,
  resolveSchoolSettingsForYear,
  syncActiveYearSetting,
};
