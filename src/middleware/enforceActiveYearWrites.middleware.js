"use strict";

const catchAsync = require("../utils/catchAsync");
const {
  assertYearWritable,
  parseYearId,
  resolveYearId,
} = require("../services/activeAcademicYear.service");
const models = require("../models/index.model");

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths that may mutate without an active-academic-year check (step 3.4). */
const WHITELIST_PREFIXES = [
  "/api/test",
  "/api/health",
  "/api/login",
  "/api/register",
  "/api/setup-admin",
  "/api/check-user",
  "/api/reset-password",
  "/api/change-password",
  "/api/logout",
  "/api/users",
  "/api/profile",
  "/api/messages",
  "/api/groups",
  "/api/lessons",
  "/api/lesson-plans",
  "/api/salary",
  "/api/timetables",
  "/api/events",
  "/api/cases",
  "/api/financial",
  "/api/report-inventory",
  "/api/property-equipment",
  "/api/asset-categories",
  "/api/budget-heads",
  "/api/monitor",
  "/api/vocational",
  "/api/hods",
  "/api/staff-attendance",
  "/api/discipline-cases",
  "/api/teachers",
  "/api/v1/teachers",
  "/api/specialties",
  "/api/classes",
  "/api/v1/academic-years",
  "/api/v1/subjects",
  "/api/v1/class-subjects",
  "/api/v1/department-classes",
  "/api/v1/classes",
  "/api/v1/departments",
  "/api/v1/content",
  "/api/v1/desktop",
  "/api/v1/sync",
];

/** Routes that always scope writes to an academic year. */
const ENFORCE_PREFIXES = [
  "/api/v1/marks",
  "/api/v1/students",
  "/api/v1/academic-bands",
  "/api/v1/report-cards",
  "/api/students",
  "/api/fees",
];

const YEAR_ID_BODY_KEYS = [
  "academic_year_id",
  "academicYearId",
  "academicYear",
  "accademic_year_id",
];

const YEAR_ID_PARAM_KEYS = [
  "academic_year_id",
  "academicYearId",
  "academicYear",
];

function normalizePath(req) {
  const path = (req.originalUrl || req.url || "").split("?")[0];
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function matchesPrefix(path, prefixes) {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function isWhitelisted(path) {
  return matchesPrefix(path, WHITELIST_PREFIXES);
}

function shouldEnforce(path, req) {
  if (isWhitelisted(path)) return false;
  if (matchesPrefix(path, ENFORCE_PREFIXES)) return true;
  return hasExplicitYearReference(req);
}

function pickYearId(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return null;
}

function hasExplicitYearReference(req) {
  return Boolean(
    pickYearId(req.body, YEAR_ID_BODY_KEYS) ||
      pickYearId(req.params, YEAR_ID_PARAM_KEYS) ||
      pickYearId(req.query, YEAR_ID_PARAM_KEYS)
  );
}

function extractDirectYearId(req) {
  return (
    pickYearId(req.body, YEAR_ID_BODY_KEYS) ||
    pickYearId(req.params, YEAR_ID_PARAM_KEYS) ||
    pickYearId(req.query, YEAR_ID_PARAM_KEYS)
  );
}

async function resolveLinkedRecordYearId(req, path) {
  const rawId = req.params?.id;
  if (rawId === undefined || rawId === null || rawId === "") return null;

  const recordId = Number(rawId);
  if (!Number.isInteger(recordId) || recordId <= 0) return null;

  if (/^\/api\/v1\/marks\/\d+$/.test(path)) {
    const row = await models.Mark.findByPk(recordId, {
      attributes: ["academic_year_id"],
      raw: true,
    });
    return row?.academic_year_id ?? null;
  }

  if (/^\/api\/v1\/students\/\d+$/.test(path)) {
    const row = await models.Student.findByPk(recordId, {
      attributes: ["academic_year_id"],
      raw: true,
    });
    return row?.academic_year_id ?? null;
  }

  if (/^\/api\/students\/\d+$/.test(path)) {
    const row = await models.Student.findByPk(recordId, {
      attributes: ["academic_year_id"],
      raw: true,
    });
    return row?.academic_year_id ?? null;
  }

  if (/^\/api\/v1\/academic-bands\/\d+$/.test(path)) {
    const row = await models.AcademicBand.findByPk(recordId, {
      attributes: ["academic_year_id"],
      raw: true,
    });
    return row?.academic_year_id ?? null;
  }

  return null;
}

async function resolveTargetYearId(req) {
  const direct = extractDirectYearId(req);
  if (direct !== null) {
    return parseYearId(direct);
  }

  const path = normalizePath(req);
  const linked = await resolveLinkedRecordYearId(req, path);
  if (linked !== null) {
    return parseYearId(linked);
  }

  return resolveYearId(null);
}

/**
 * Blocks POST/PUT/PATCH/DELETE against non-active (read-only) academic years.
 * GET/HEAD/OPTIONS always pass through.
 */
const enforceActiveYearWrites = catchAsync(async (req, res, next) => {
  const method = (req.method || "GET").toUpperCase();
  if (READ_METHODS.has(method)) {
    return next();
  }

  const path = normalizePath(req);
  if (!shouldEnforce(path, req)) {
    return next();
  }

  const targetYearId = await resolveTargetYearId(req);
  await assertYearWritable(targetYearId);

  req.activeAcademicYearId = targetYearId;
  return next();
});

module.exports = {
  enforceActiveYearWrites,
  normalizePath,
  isWhitelisted,
  shouldEnforce,
  WHITELIST_PREFIXES,
  ENFORCE_PREFIXES,
};
