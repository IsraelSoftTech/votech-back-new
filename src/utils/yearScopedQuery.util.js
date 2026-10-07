"use strict";

/**
 * Operational records (everything except departments, classes, subjects,
 * and users) belong to the academic year they were created in. Lists
 * default to the active year so archived-year data stays hidden until
 * that year is switched back to active — the same rule students already
 * follow.
 */

const { getActiveYear } = require("../services/activeAcademicYear.service");

async function resolveListYearId(req) {
  const raw =
    req?.query?.academic_year_id ??
    req?.body?.academic_year_id ??
    req?.params?.academic_year_id;
  if (raw !== undefined && raw !== null && raw !== "") {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) return id;
  }
  const active = await getActiveYear();
  return active?.id ?? null;
}

async function getStampYearId() {
  const active = await getActiveYear();
  return active?.id ?? null;
}

/** Bindable year id for SQL; -1 matches nothing if no year is configured. */
function yearParam(yearId) {
  return yearId == null ? -1 : yearId;
}

function andYearSql(column, params, yearId) {
  params.push(yearParam(yearId));
  return `${column} = $${params.length}`;
}

module.exports = {
  resolveListYearId,
  getStampYearId,
  yearParam,
  andYearSql,
};
