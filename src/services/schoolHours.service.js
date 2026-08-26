"use strict";

const { pool } = require("../../routes/utils");
const { CAMEROON_TZ, parseTimeToMinutes } = require("../utils/cameroonTime.util");
const {
  getMinutesInCameroon,
  formatTime12h,
  formatTime12FromTimeString,
  nowInCameroon,
} = require("../utils/cameroonTime.util");

const DEFAULTS = {
  school_start_time: "07:30:00",
  school_end_time: "17:00:00",
  check_in_opens_at: "06:00:00",
  allow_checkout_before_end: false,
  checkout_grace_minutes_after_end: 30,
  timezone: CAMEROON_TZ,
};

function normalizeTimeInput(value, fallback) {
  if (value == null || value === "") return fallback;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return fallback;
  const h = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, "0");
  const m = String(Math.min(59, Math.max(0, Number(match[2])))).padStart(2, "0");
  const s = match[3] ? String(Number(match[3])).padStart(2, "0") : "00";
  return `${h}:${m}:${s}`;
}

function normalizeGraceMinutes(value, fallback = DEFAULTS.checkout_grace_minutes_after_end) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.round(n), 24 * 60);
}

function formatMinutesAs12h(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function getCheckoutGraceMinutes(settings) {
  return normalizeGraceMinutes(
    settings?.checkout_grace_minutes_after_end,
    DEFAULTS.checkout_grace_minutes_after_end
  );
}

function getCheckoutCloseMinutes(settings) {
  const schoolEnd = parseTimeToMinutes(settings.school_end_time);
  return schoolEnd + getCheckoutGraceMinutes(settings);
}

function computeCheckOutAllowed(settings, nowMinutes) {
  const checkInOpens = parseTimeToMinutes(settings.check_in_opens_at);
  const schoolEnd = parseTimeToMinutes(settings.school_end_time);
  const checkoutClose = getCheckoutCloseMinutes(settings);

  if (nowMinutes > checkoutClose) return false;

  if (settings.allow_checkout_before_end) {
    return nowMinutes >= checkInOpens;
  }

  return nowMinutes >= schoolEnd;
}

function formatSettingsRow(row = {}) {
  return {
    school_start_time: String(row.school_start_time || DEFAULTS.school_start_time).slice(0, 8),
    school_end_time: String(row.school_end_time || DEFAULTS.school_end_time).slice(0, 8),
    check_in_opens_at: String(row.check_in_opens_at || DEFAULTS.check_in_opens_at).slice(0, 8),
    allow_checkout_before_end: Boolean(row.allow_checkout_before_end),
    checkout_grace_minutes_after_end: normalizeGraceMinutes(
      row.checkout_grace_minutes_after_end,
      DEFAULTS.checkout_grace_minutes_after_end
    ),
    timezone: row.timezone || DEFAULTS.timezone,
    updated_at: row.updated_at || null,
  };
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_hours_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      school_start_time TIME NOT NULL DEFAULT '07:30:00',
      school_end_time TIME NOT NULL DEFAULT '17:00:00',
      check_in_opens_at TIME NOT NULL DEFAULT '06:00:00',
      allow_checkout_before_end BOOLEAN NOT NULL DEFAULT false,
      checkout_grace_minutes_after_end INTEGER NOT NULL DEFAULT 30,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Douala',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await pool.query(`
    ALTER TABLE school_hours_settings
    ADD COLUMN IF NOT EXISTS check_in_opens_at TIME NOT NULL DEFAULT '06:00:00'
  `);
  await pool.query(`
    ALTER TABLE school_hours_settings
    ADD COLUMN IF NOT EXISTS allow_checkout_before_end BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE school_hours_settings
    ADD COLUMN IF NOT EXISTS checkout_grace_minutes_after_end INTEGER NOT NULL DEFAULT 30
  `);
  await pool.query(`
    INSERT INTO school_hours_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING
  `);
}

async function getSchoolHours() {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT * FROM school_hours_settings WHERE id = 1`
  );
  return formatSettingsRow(rows[0]);
}

function buildScannerStatus(settings, now = nowInCameroon()) {
  const nowMinutes = getMinutesInCameroon(now);
  const checkInOpens = parseTimeToMinutes(settings.check_in_opens_at);
  const schoolEnd = parseTimeToMinutes(settings.school_end_time);
  const checkoutClose = getCheckoutCloseMinutes(settings);
  const grace = getCheckoutGraceMinutes(settings);

  const checkInAllowed =
    nowMinutes >= checkInOpens && nowMinutes < schoolEnd;
  const checkOutAllowed = computeCheckOutAllowed(settings, nowMinutes);

  return {
    now: formatTime12h(now),
    check_in_allowed: checkInAllowed,
    check_out_allowed: checkOutAllowed,
    check_in_opens_at: settings.check_in_opens_at,
    check_in_opens_at_display: formatTime12FromTimeString(settings.check_in_opens_at),
    school_end_time: settings.school_end_time,
    school_end_time_display: formatTime12FromTimeString(settings.school_end_time),
    checkout_grace_minutes_after_end: grace,
    checkout_closes_at_display: formatMinutesAs12h(checkoutClose),
    allow_checkout_before_end: Boolean(settings.allow_checkout_before_end),
    check_out_before_school_end: nowMinutes < schoolEnd,
    check_out_after_close: nowMinutes > checkoutClose,
  };
}

async function getSchoolHoursWithScannerStatus() {
  const settings = await getSchoolHours();
  return {
    ...settings,
    scanner: buildScannerStatus(settings),
  };
}

async function updateSchoolHours(payload, userId = null) {
  await ensureTable();

  const current = await getSchoolHours();
  const start = normalizeTimeInput(
    payload.school_start_time,
    current.school_start_time
  );
  const end = normalizeTimeInput(payload.school_end_time, current.school_end_time);
  const checkInOpens = normalizeTimeInput(
    payload.check_in_opens_at,
    current.check_in_opens_at
  );
  const allowEarlyCheckout =
    payload.allow_checkout_before_end !== undefined
      ? Boolean(payload.allow_checkout_before_end)
      : current.allow_checkout_before_end;
  const checkoutGrace = normalizeGraceMinutes(
    payload.checkout_grace_minutes_after_end,
    current.checkout_grace_minutes_after_end
  );

  if (parseTimeToMinutes(checkInOpens) > parseTimeToMinutes(start)) {
    const err = new Error("Check-in open time cannot be after school start time");
    err.statusCode = 400;
    throw err;
  }
  if (parseTimeToMinutes(start) >= parseTimeToMinutes(end)) {
    const err = new Error("School start time must be before end time");
    err.statusCode = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `
    UPDATE school_hours_settings
    SET school_start_time = $1::time,
        school_end_time = $2::time,
        check_in_opens_at = $3::time,
        allow_checkout_before_end = $4,
        checkout_grace_minutes_after_end = $5,
        timezone = $6,
        updated_at = NOW(),
        updated_by = $7
    WHERE id = 1
    RETURNING *
  `,
    [
      start,
      end,
      checkInOpens,
      allowEarlyCheckout,
      checkoutGrace,
      payload.timezone || CAMEROON_TZ,
      userId,
    ]
  );

  return formatSettingsRow(rows[0]);
}

function assertCheckInAllowed(settings, now = nowInCameroon()) {
  const status = buildScannerStatus(settings, now);
  if (status.check_in_allowed) return;

  const nowMinutes = getMinutesInCameroon(now);
  const checkInOpens = parseTimeToMinutes(settings.check_in_opens_at);

  if (nowMinutes < checkInOpens) {
    const err = new Error(
      `Check-in opens at ${status.check_in_opens_at_display}`
    );
    err.statusCode = 403;
    throw err;
  }

  const err = new Error(
    `Check-in is closed for today (school ends at ${status.school_end_time_display})`
  );
  err.statusCode = 403;
  throw err;
}

function assertCheckOutAllowed(settings, now = nowInCameroon()) {
  const status = buildScannerStatus(settings, now);
  if (status.check_out_allowed) return;

  const nowMinutes = getMinutesInCameroon(now);
  const schoolEnd = parseTimeToMinutes(settings.school_end_time);
  const checkInOpens = parseTimeToMinutes(settings.check_in_opens_at);

  if (status.check_out_after_close) {
    const err = new Error(
      `Check-out is closed for today (window ended at ${status.checkout_closes_at_display})`
    );
    err.statusCode = 403;
    throw err;
  }

  if (!settings.allow_checkout_before_end && nowMinutes < schoolEnd) {
    const err = new Error(
      `Check-out opens at ${status.school_end_time_display}`
    );
    err.statusCode = 403;
    throw err;
  }

  if (nowMinutes < checkInOpens) {
    const err = new Error(
      `Check-out opens at ${status.check_in_opens_at_display}`
    );
    err.statusCode = 403;
    throw err;
  }

  const err = new Error("Check-out is not available at this time");
  err.statusCode = 403;
  throw err;
}

module.exports = {
  DEFAULTS,
  getSchoolHours,
  getSchoolHoursWithScannerStatus,
  buildScannerStatus,
  computeCheckOutAllowed,
  updateSchoolHours,
  assertCheckInAllowed,
  assertCheckOutAllowed,
};
