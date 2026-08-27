/* controllers/teacherDashboard.controller.js
 *
 * Self-scoped dashboard for a teacher (or class master), everything here
 * keys off req.user.id directly against ClassSubject.teacher_id and
 * Class.class_master_id, the same real relations the marks module and
 * marksOverview.controller.js already rely on. This replaces the old
 * TeacherDash.jsx's approach of fuzzy-matching the logged-in user against
 * a teachers-table row by name/contact, then reading a comma-separated
 * string of class names off it, fragile, and blind to class-master
 * status entirely.
 */

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const appResponder = require("../utils/appResponder");
const models = require("../models/index.model");
const { computeCoverage } = require("./marksOverview.controller");

const getTeacherDashboard = catchAsync(async (req, res, next) => {
  const teacherId = req.user.id;

  const activeYear = await models.AcademicYear.findOne({ where: { status: "active" } });
  if (!activeYear) {
    return next(new AppError("No active academic year is set.", StatusCodes.BAD_REQUEST));
  }

  const classSubjects = await models.ClassSubject.findAll({
    // "My Classes" is present-tense — this year's assignments only.
    where: { teacher_id: teacherId, academic_year_id: activeYear.id },
    include: [
      { model: models.Class, as: "class", attributes: ["id", "name", "class_master_id", "department_id"] },
      { model: models.Subject, as: "subject", attributes: ["id", "code", "name"] },
    ],
  });

  const classesById = new Map();
  const subjectsByCode = new Map();
  for (const cs of classSubjects) {
    if (!cs.class || !cs.subject) continue;
    if (!classesById.has(cs.class.id)) {
      classesById.set(cs.class.id, {
        id: cs.class.id,
        name: cs.class.name,
        departmentId: cs.class.department_id,
        subjects: [],
      });
    }
    classesById.get(cs.class.id).subjects.push({
      id: cs.subject.id,
      code: cs.subject.code,
      title: cs.subject.name,
    });
    subjectsByCode.set(cs.subject.code, cs.subject.name);
  }
  const taughtClassIds = [...classesById.keys()];

  const masterClasses = await models.Class.findAll({
    where: { class_master_id: teacherId },
    attributes: ["id", "name"],
    raw: true,
  });
  const masterClassIds = masterClasses.map((c) => c.id);

  // One roster query covers both "classes I teach" and "classes I'm
  // master of", a class can be both, and either list can be empty.
  const rosterClassIds = [...new Set([...taughtClassIds, ...masterClassIds])];
  const roster = rosterClassIds.length
    ? await models.Student.findAll({
        where: { class_id: { [Op.in]: rosterClassIds }, academic_year_id: activeYear.id, status: "active" },
        attributes: ["id", "class_id"],
        raw: true,
      })
    : [];
  const countByClass = new Map();
  for (const s of roster) countByClass.set(s.class_id, (countByClass.get(s.class_id) || 0) + 1);

  const classes = [...classesById.values()]
    .map((c) => ({ ...c, studentCount: countByClass.get(c.id) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const classMasterOf = masterClasses
    .map((c) => ({ id: c.id, name: c.name, studentCount: countByClass.get(c.id) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalStudents = taughtClassIds
    .map((id) => countByClass.get(id) || 0)
    .reduce((a, b) => a + b, 0);

  // "Marks I still owe" scoped to this teacher, against whichever
  // sequence is currently in active use. There's no explicit "current
  // sequence" flag in the schema, sequences for a year are typically all
  // seeded upfront, so picking the highest order_number would always land
  // on the LAST sequence of the year, not whichever one people are
  // actually filling right now. The most recently entered mark anywhere
  // in the school this year is a much better signal of that; a brand-new
  // year with zero marks yet falls back to sequence #1.
  let marksOwed = null;
  const mostRecentMark = await models.Mark.findOne({
    where: { academic_year_id: activeYear.id },
    order: [["createdAt", "DESC"]],
  });
  const currentSequence = mostRecentMark
    ? await models.Sequence.findByPk(mostRecentMark.sequence_id)
    : await models.Sequence.findOne({
        where: { academic_year_id: activeYear.id },
        order: [["order_number", "ASC"]],
      });
  if (currentSequence) {
    try {
      const coverage = await computeCoverage({
        academicYearId: activeYear.id,
        sequenceId: currentSequence.id,
        teacherId,
      });
      const assignments = (coverage.teacherRows[0]?.assignments || []).filter(
        (a) => a.status !== "complete"
      );
      marksOwed = {
        sequenceLabel: coverage.summary.sequenceLabel,
        academicYearId: activeYear.id,
        sequenceId: currentSequence.id,
        termId: currentSequence.term_id,
        assignments: assignments.map((a) => ({
          classId: a.classId,
          className: a.className,
          departmentId: a.departmentId,
          subjectId: a.subjectId,
          subjectTitle: a.subjectTitle,
          status: a.status,
          missingCount: a.missingStudents.length,
        })),
      };
    } catch (err) {
      marksOwed = null;
    }
  }

  appResponder(
    StatusCodes.OK,
    {
      academicYear: activeYear.name,
      academicYearId: activeYear.id,
      classes,
      classMasterOf,
      totalStudents,
      totalSubjects: subjectsByCode.size,
      marksOwed,
    },
    res
  );
});

module.exports = {
  getTeacherDashboard,
};
