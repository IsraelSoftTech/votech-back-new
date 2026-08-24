"use strict";

const { StatusCodes } = require("http-status-codes");
const AppError = require("../utils/AppError");
const models = require("../models/index.model");

const CACHE_TTL_MS = 60 * 1000;

/** @type {{ row: object|null, expiresAt: number }|null} */
let activeYearCache = null;

function parseYearId(yearId) {
  if (yearId === null || yearId === undefined || yearId === "") {
    return null;
  }
  const id = Number(yearId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(
      "Invalid academic year id",
      StatusCodes.BAD_REQUEST
    );
  }
  return id;
}

function toPlain(row) {
  if (!row) return null;
  return typeof row.toJSON === "function" ? row.toJSON() : row;
}

function clearActiveYearCache() {
  activeYearCache = null;
}

/**
 * Returns the current active academic year row (cached ~60s).
 * @returns {Promise<object|null>}
 */
async function getActiveYear({ bypassCache = false } = {}) {
  const now = Date.now();
  if (
    !bypassCache &&
    activeYearCache &&
    activeYearCache.expiresAt > now
  ) {
    return activeYearCache.row;
  }

  const row = await models.AcademicYear.findOne({
    where: { status: "active" },
    order: [["id", "DESC"]],
  });

  const plain = toPlain(row);
  activeYearCache = {
    row: plain,
    expiresAt: now + CACHE_TTL_MS,
  };

  return plain;
}

/**
 * Returns the active academic year id, or throws 503 if none is configured.
 * @returns {Promise<number>}
 */
async function getActiveYearId(options) {
  const active = await getActiveYear(options);
  if (!active?.id) {
    throw new AppError(
      "No active academic year is configured. Contact Admin3.",
      StatusCodes.SERVICE_UNAVAILABLE
    );
  }
  return active.id;
}

/**
 * Load a year by primary key (no cache).
 * @returns {Promise<object|null>}
 */
async function getYearById(yearId) {
  const id = parseYearId(yearId);
  if (!id) return null;

  const row = await models.AcademicYear.findByPk(id);
  return toPlain(row);
}

/**
 * @returns {Promise<boolean>}
 */
async function isYearArchived(yearId) {
  const id = parseYearId(yearId);
  if (!id) return false;

  const year = await getYearById(id);
  if (!year) {
    throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
  }
  return year.status === "archived";
}

/**
 * Writable only when status is active and not locked for editing.
 * @returns {Promise<boolean>}
 */
async function isYearWritable(yearId) {
  const id = parseYearId(yearId);
  if (!id) return false;

  const year = await getYearById(id);
  if (!year) {
    throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
  }

  return year.status === "active" && year.is_locked_for_editing !== true;
}

/**
 * Ensures the year exists and accepts writes; throws 403 otherwise.
 * @returns {Promise<object>} plain academic year row
 */
async function assertYearWritable(yearId) {
  const id = parseYearId(yearId);
  if (!id) {
    throw new AppError(
      "Academic year is required",
      StatusCodes.BAD_REQUEST
    );
  }

  const year = await getYearById(id);
  if (!year) {
    throw new AppError("Academic year not found", StatusCodes.NOT_FOUND);
  }

  if (!(await isYearWritable(id))) {
    throw new AppError(
      "This academic year is read-only. Only the active year accepts changes.",
      StatusCodes.FORBIDDEN
    );
  }

  return year;
}

/**
 * Resolves a requested year id, defaulting to the active year when omitted.
 * @returns {Promise<number>}
 */
async function resolveYearId(yearId) {
  const parsed = parseYearId(yearId);
  if (parsed) return parsed;
  return getActiveYearId();
}

module.exports = {
  CACHE_TTL_MS,
  clearActiveYearCache,
  getActiveYear,
  getActiveYearId,
  getYearById,
  isYearArchived,
  isYearWritable,
  assertYearWritable,
  resolveYearId,
  parseYearId,
};
