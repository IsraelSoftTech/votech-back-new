"use strict";

const models = require("../models/index.model");

/**
 * Returns counts of records linked to an academic year (students, marks, bands, report cards).
 */
async function getAcademicYearLinkedCounts(yearId, transaction = null) {
  const queryOpts = transaction ? { transaction } : {};

  const [students, marks, bands, reportCards, snapshots] = await Promise.all([
    models.Student.count({
      where: { academic_year_id: yearId },
      ...queryOpts,
    }),
    models.Mark.count({
      where: { academic_year_id: yearId },
      ...queryOpts,
    }),
    models.AcademicBand.count({
      where: { academic_year_id: yearId },
      ...queryOpts,
    }),
    models.ReportCardComment.count({
      where: { academic_year_id: yearId },
      ...queryOpts,
    }),
    models.ReportCardSnapshot.count({
      where: { academic_year_id: yearId },
      ...queryOpts,
    }),
  ]);

  return {
    students,
    marks,
    bands,
    reportCards,
    snapshots,
    total: students + marks + bands + reportCards + snapshots,
  };
}

function formatLinkedDataError(counts) {
  const parts = [];
  if (counts.students > 0) parts.push(`${counts.students} student(s)`);
  if (counts.marks > 0) parts.push(`${counts.marks} mark(s)`);
  if (counts.bands > 0) parts.push(`${counts.bands} academic band(s)`);
  if (counts.reportCards > 0) parts.push(`${counts.reportCards} report card(s)`);
  if (counts.snapshots > 0) parts.push(`${counts.snapshots} report snapshot(s)`);
  return parts.join(", ");
}

module.exports = {
  getAcademicYearLinkedCounts,
  formatLinkedDataError,
};
