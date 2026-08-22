"use strict";

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const AppError = require("./AppError");

// Once a student's (class, academic_year) pair has been closed out by a
// completed (non-reversed) promotion move, no new marks may be written
// against that exact pair. The promotion decision was computed from the
// marks as they stood at that time, and silently letting new marks trickle
// in afterward would make that decision stale without anyone noticing.
// The only way to correct marks after promotion is: reverse the move,
// fix the marks, re-run promotion for that class.

function getModels() {
  // Required lazily to avoid a require-cycle with models/index.model.js
  // at module-load time (promotion models associate against Mark et al).
  return require("../models/index.model");
}

/**
 * Returns a Set of studentIds (from the given list) whose (classId, academicYearId)
 * pair is currently locked by a completed promotion move.
 */
async function getLockedStudentIds(studentIds, classId, academicYearId) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return new Set();
  if (!classId || !academicYearId) return new Set();

  const models = getModels();

  const rows = await models.StudentPromotion.findAll({
    where: {
      student_id: { [Op.in]: studentIds },
      from_class_id: classId,
      from_academic_year_id: academicYearId,
    },
    include: [
      {
        association: models.StudentPromotion.associations.move,
        attributes: [],
        where: { status: { [Op.ne]: "reversed" } },
        required: true,
      },
    ],
    attributes: ["student_id"],
    raw: true,
  });

  return new Set(rows.map((r) => r.student_id));
}

/**
 * Throws a human-readable AppError if this single student's (classId,
 * academicYearId) pair is locked. Used by the single create/update mark
 * endpoints.
 */
async function assertNotPromoted(studentId, classId, academicYearId) {
  const locked = await getLockedStudentIds([studentId], classId, academicYearId);
  if (locked.has(studentId)) {
    throw new AppError(
      "This student was already promoted out of this class for this academic year. " +
        "An Admin3 must reverse that promotion before marks here can be changed.",
      StatusCodes.CONFLICT
    );
  }
}

module.exports = { getLockedStudentIds, assertNotPromoted };
