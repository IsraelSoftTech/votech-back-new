"use strict";

const { StatusCodes } = require("http-status-codes");
const AppError = require("../utils/AppError");

const MAX_ATTEMPTS = 3;
const WINDOW_MS = 60 * 60 * 1000;

/** @type {Map<number, number[]>} userId -> attempt timestamps */
const attemptLog = new Map();

function pruneOldAttempts(timestamps, windowStart) {
  return timestamps.filter((t) => t > windowStart);
}

/**
 * Rate-limit academic year switch/rollover: max 3 attempts per user per hour.
 */
function academicYearSwitchRateLimit(req, res, next) {
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return next();
  }

  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = pruneOldAttempts(attemptLog.get(userId) || [], windowStart);

  if (recent.length >= MAX_ATTEMPTS) {
    return next(
      new AppError(
        "Too many academic year switch attempts. Maximum 3 per hour. Please wait before trying again.",
        StatusCodes.TOO_MANY_REQUESTS
      )
    );
  }

  recent.push(now);
  attemptLog.set(userId, recent);
  return next();
}

module.exports = { academicYearSwitchRateLimit, MAX_ATTEMPTS, WINDOW_MS };
