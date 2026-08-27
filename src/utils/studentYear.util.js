"use strict";

const models = require("../models/index.model");

// Which class was a student actually IN during a given academic year —
// not necessarily their current class, if that year is archived and
// they've since been promoted or reassigned. Order of preference:
// 1. An existing Mark row for that year (authoritative — it's what was
//    literally used when marks were entered).
// 2. StudentPromotion history (the year they were promoted FROM).
// 3. The student's current position, only if the requested year IS
//    their current one.
// Shared by the single-student marks editor, the single-student report
// card download, and (independently, via its own StudentPromotion-based
// walk) the transcript builder — all three need "which class for which
// year" answered the same way, or a report card/marks edit could
// silently disagree with a transcript for the same year.
async function resolveStudentClassForYear(student, academicYearId) {
  const existingMark = await models.Mark.findOne({
    where: { student_id: student.id, academic_year_id: academicYearId },
    attributes: ["class_id"],
    raw: true,
  });
  if (existingMark) return existingMark.class_id;

  const promotion = await models.StudentPromotion.findOne({
    where: { student_id: student.id, from_academic_year_id: academicYearId },
    attributes: ["from_class_id"],
    raw: true,
  });
  if (promotion) return promotion.from_class_id;

  if (Number(student.academic_year_id) === Number(academicYearId)) {
    return student.class_id;
  }

  return null;
}

module.exports = { resolveStudentClassForYear };
