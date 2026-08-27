"use strict";

// Shared by every report-card/master-sheet/matrix generator — resolves
// who was class master of a class in a SPECIFIC year (class_master_assignments,
// year-scoped, frozen once the year passes), not classes.class_master_id
// (a single mutable "current value" field that a later reassignment would
// otherwise silently rewrite on every past document that gets reprinted).
async function resolveClassMasterName(classId, academicYearId) {
  const models = require("../models/index.model");

  if (academicYearId) {
    const assignment = await models.ClassMasterAssignment.findOne({
      where: { class_id: classId, academic_year_id: academicYearId },
      include: [{ model: models.User, as: "teacher", attributes: ["name", "username"] }],
    });
    if (assignment?.teacher) {
      return assignment.teacher.name || assignment.teacher.username || "";
    }
  }

  // No history recorded for this year (most likely a year that predates
  // this table existing) — fall back to whatever classes.class_master_id
  // currently says, a best-effort guess rather than a blank name.
  const cls = await models.Class.findByPk(classId, {
    include: [{ model: models.User, as: "classMaster", attributes: ["name", "username"] }],
  });
  return cls?.classMaster?.name || cls?.classMaster?.username || "";
}

module.exports = { resolveClassMasterName };
