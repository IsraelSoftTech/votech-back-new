"use strict";

const catchAsync = require("../utils/catchAsync");
const { injectActiveYearIntoBody } = require("../utils/academicYearScope.util");

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Ensures year-scoped CREATE/UPDATE payloads include academic_year_id (active year default).
 */
const injectActiveAcademicYearBody = catchAsync(async (req, res, next) => {
  const method = (req.method || "GET").toUpperCase();
  if (!WRITE_METHODS.has(method)) {
    return next();
  }

  await injectActiveYearIntoBody(req);
  return next();
});

module.exports = { injectActiveAcademicYearBody };
