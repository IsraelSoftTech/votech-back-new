"use strict";

const CAMEROON_TZ = "Africa/Douala";

function parseTimeToMinutes(timeValue) {
  if (!timeValue) return 0;
  const raw = String(timeValue).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getZonedParts(date, timeZone = CAMEROON_TZ) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Current instant (UTC stored; display/compare in Cameroon). */
function nowInCameroon() {
  return new Date();
}

/** YYYY-MM-DD in Cameroon calendar. */
function getTodayDateCameroon(date = new Date()) {
  const p = getZonedParts(date);
  const y = p.year;
  const m = String(p.month).padStart(2, "0");
  const d = String(p.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 12-hour format e.g. "7:30 AM". */
function formatTime12h(date, timeZone = CAMEROON_TZ) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Minutes since midnight in Cameroon for the given instant. */
function getMinutesInCameroon(date = new Date()) {
  const p = getZonedParts(date);
  return p.hour * 60 + p.minute;
}

/**
 * Compare check-in time vs school start on the same Cameroon day.
 * @returns {{ status: 'on_time'|'late', minutesLate: number }}
 */
function computeCheckInStatus(checkInDate, schoolStartTime) {
  const startMinutes = parseTimeToMinutes(schoolStartTime);
  const nowMinutes = getMinutesInCameroon(checkInDate);

  if (nowMinutes > startMinutes) {
    return {
      status: "late",
      minutesLate: nowMinutes - startMinutes,
    };
  }

  return { status: "on_time", minutesLate: 0 };
}

function formatTime12FromParts(hours, minutes) {
  const h = Number(hours);
  const m = Number(minutes);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatTime12FromTimeString(timeStr) {
  const match = String(timeStr || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "—";
  return formatTime12FromParts(Number(match[1]), Number(match[2]));
}

module.exports = {
  CAMEROON_TZ,
  nowInCameroon,
  getTodayDateCameroon,
  formatTime12h,
  formatTime12FromTimeString,
  formatDateDisplay,
  getMinutesInCameroon,
  parseTimeToMinutes,
  computeCheckInStatus,
};
