"use strict";

/**
 * Calendar dates (Postgres DATE) must stay YYYY-MM-DD.
 * node-pg turns them into local-midnight Date objects, and JSON then
 * emits the previous UTC day. Always read the local calendar fields.
 */
function localYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toCalendarDateString(value) {
  if (value == null || value === "") return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return localYmd(value);
  }

  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || /^\d{4}-\d{2}-\d{2} /.test(raw)) {
    const parsed = new Date(raw.includes(" ") ? raw.replace(" ", "T") : raw);
    if (!Number.isNaN(parsed.getTime())) return localYmd(parsed);
  }

  return "";
}

module.exports = {
  toCalendarDateString,
};
