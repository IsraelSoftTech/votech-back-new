"use strict";

const models = require("../models/index.model");

/**
 * Returns counts of records linked to an academic year (students, marks, bands, report cards).
 */
async function getAcademicYearLinkedCounts(yearId, transaction = null) {
  const queryOpts = transaction ? { transaction } : {};

  // Each count is independent: one table that cannot be counted (e.g. a
  // deployment where it was never created) is reported in `errors` instead
  // of failing the whole check. Callers that DELETE must treat a non-empty
  // `errors` as "cannot verify" and refuse; read-only callers just show it.
  const targets = [
    ["students", models.Student],
    ["marks", models.Mark],
    ["bands", models.AcademicBand],
    ["reportCards", models.ReportCardComment],
    ["snapshots", models.ReportCardSnapshot],
  ];
  const settled = await Promise.allSettled(
    targets.map(([, model]) => model.count({ where: { academic_year_id: yearId }, ...queryOpts }))
  );
  const counts = {};
  const errors = [];
  settled.forEach((r, i) => {
    const key = targets[i][0];
    if (r.status === "fulfilled") counts[key] = r.value;
    else {
      counts[key] = 0;
      errors.push(`${key}: ${r.reason?.parent?.message || r.reason?.message || "count failed"}`);
    }
  });
  return {
    ...counts,
    total: Object.values(counts).reduce((n, v) => n + v, 0),
    errors,
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
