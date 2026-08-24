"use strict";

const {
  getActiveYear,
  getActiveYearId,
  parseYearId,
} = require("../services/activeAcademicYear.service");

const YEAR_ID_KEYS = [
  "academic_year_id",
  "academicYearId",
  "academicYear",
  "accademic_year_id",
];

function pickYearIdFromObject(source) {
  if (!source || typeof source !== "object") return null;
  for (const key of YEAR_ID_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function pickYearIdFromRequest(req) {
  return (
    pickYearIdFromObject(req.body) ||
    pickYearIdFromObject(req.params) ||
    pickYearIdFromObject(req.query)
  );
}

/**
 * Default list queries to the active academic year unless a year is specified
 * or all_years=true is passed (historical / admin views).
 */
async function applyDefaultYearListFilter(req) {
  if (req.query.all_years === "true" || req.query.all_years === true) {
    return null;
  }
  if (pickYearIdFromObject(req.query)) {
    return parseYearId(pickYearIdFromObject(req.query));
  }
  const active = await getActiveYear();
  if (active?.id) {
    req.query.academic_year_id = String(active.id);
    return active.id;
  }
  return null;
}

/**
 * Inject active academic year id into req.body when creating year-scoped records.
 */
async function injectActiveYearIntoBody(req) {
  const existing = pickYearIdFromRequest(req);
  if (existing !== null) {
    return parseYearId(existing);
  }

  const activeId = await getActiveYearId();
  if (!req.body || typeof req.body !== "object") {
    req.body = {};
  }

  req.body.academic_year_id = activeId;
  if ("academicYear" in req.body && !req.body.academicYear) {
    req.body.academicYear = activeId;
  }
  if ("academicYearId" in req.body && !req.body.academicYearId) {
    req.body.academicYearId = activeId;
  }

  return activeId;
}

module.exports = {
  YEAR_ID_KEYS,
  pickYearIdFromObject,
  pickYearIdFromRequest,
  applyDefaultYearListFilter,
  injectActiveYearIntoBody,
};
