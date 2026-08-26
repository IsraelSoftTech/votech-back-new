"use strict";

const { pool } = require("../../routes/utils");
const { getActiveYear } = require("./activeAcademicYear.service");
const { getSchoolHours, assertCheckInAllowed, assertCheckOutAllowed } = require("./schoolHours.service");
const {
  nowInCameroon,
  getTodayDateCameroon,
  formatTime12h,
  formatDateDisplay,
  computeCheckInStatus,
} = require("../utils/cameroonTime.util");

async function resolveStudentByQrToken(qrToken) {
  const token = String(qrToken || "").trim();
  if (!token) return null;

  const { rows } = await pool.query(
    `
    SELECT
      sic.student_id AS student_db_id,
      sic.qr_token,
      sic.is_active,
      s.student_id,
      s.full_name,
      s.class_id,
      s.academic_year_id,
      c.name AS class_name
    FROM student_id_cards sic
    INNER JOIN students s ON s.id = sic.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE sic.qr_token = $1
      AND sic.is_active = true
      AND s."deletedAt" IS NULL
    LIMIT 1
  `,
    [token]
  );

  return rows[0] || null;
}

async function getLogForStudentDate(studentDbId, date) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM student_attendance_logs
    WHERE student_id = $1 AND date = $2::date
    LIMIT 1
  `,
    [Number(studentDbId), date]
  );
  return rows[0] || null;
}

async function ensureLogRow(studentDbId, date, academicYearId) {
  const existing = await getLogForStudentDate(studentDbId, date);
  if (existing) return existing;

  const { rows } = await pool.query(
    `
    INSERT INTO student_attendance_logs (student_id, date, academic_year_id)
    VALUES ($1, $2::date, $3)
    ON CONFLICT (student_id, date) DO NOTHING
    RETURNING *
  `,
    [Number(studentDbId), date, academicYearId || null]
  );

  if (rows[0]) return rows[0];
  return getLogForStudentDate(studentDbId, date);
}

function buildScanResponse(student, log, action) {
  const payload = {
    action,
    student_name: student.full_name,
    student_id: student.student_id,
    class_name: student.class_name || null,
    date: log.date,
    date_display: formatDateDisplay(log.date),
    check_in_time: log.check_in_time ? formatTime12h(new Date(log.check_in_time)) : null,
    check_out_time: log.check_out_time
      ? formatTime12h(new Date(log.check_out_time))
      : null,
    check_in_status: log.check_in_status || null,
    minutes_late: log.minutes_late || 0,
    time: formatTime12h(
      new Date(action === "check_out" ? log.check_out_time : log.check_in_time)
    ),
  };

  if (action === "check_in") {
    payload.status = log.check_in_status;
    payload.late = log.check_in_status === "late";
  }

  return payload;
}

async function processAttendanceScan(qrToken, action = "check_in") {
  const scanAction = action === "check_out" ? "check_out" : "check_in";

  const student = await resolveStudentByQrToken(qrToken);
  if (!student) {
    const err = new Error("Invalid or inactive ID card");
    err.statusCode = 404;
    throw err;
  }

  const today = getTodayDateCameroon();
  const now = nowInCameroon();
  const hours = await getSchoolHours();
  const activeYear = await getActiveYear();
  const academicYearId =
    student.academic_year_id || activeYear?.id || null;

  if (scanAction === "check_in") {
    assertCheckInAllowed(hours, now);
  } else {
    assertCheckOutAllowed(hours, now);
  }

  let log = await ensureLogRow(student.student_db_id, today, academicYearId);

  if (scanAction === "check_in") {
    if (log.check_in_time) {
      const err = new Error("Already checked in for today");
      err.statusCode = 409;
      err.details = buildScanResponse(student, log, "check_in");
      throw err;
    }

    const { status, minutesLate } = computeCheckInStatus(
      now,
      hours.school_start_time
    );

    const { rows } = await pool.query(
      `
      UPDATE student_attendance_logs
      SET check_in_time = $1,
          check_in_status = $2,
          minutes_late = $3,
          academic_year_id = COALESCE(academic_year_id, $4),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `,
      [now.toISOString(), status, minutesLate, academicYearId, log.id]
    );

    return buildScanResponse(student, rows[0], "check_in");
  }

  if (!log.check_in_time) {
    const err = new Error("Must check in first");
    err.statusCode = 400;
    throw err;
  }

  if (log.check_out_time) {
    const err = new Error("Already checked out for today");
    err.statusCode = 409;
    err.details = buildScanResponse(student, log, "check_out");
    throw err;
  }

  const { rows } = await pool.query(
    `
    UPDATE student_attendance_logs
    SET check_out_time = $1,
        updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `,
    [now.toISOString(), log.id]
  );

  return buildScanResponse(student, rows[0], "check_out");
}

async function getAttendanceReport({
  fromDate,
  toDate,
  classId,
  academicYearId,
} = {}) {
  const params = [];
  let where = `WHERE s."deletedAt" IS NULL`;

  if (fromDate) {
    params.push(fromDate);
    where += ` AND sal.date >= $${params.length}::date`;
  }
  if (toDate) {
    params.push(toDate);
    where += ` AND sal.date <= $${params.length}::date`;
  }
  if (classId) {
    params.push(Number(classId));
    where += ` AND s.class_id = $${params.length}`;
  }
  if (academicYearId) {
    params.push(Number(academicYearId));
    where += ` AND COALESCE(sal.academic_year_id, s.academic_year_id) = $${params.length}`;
  }

  const sql = `
    SELECT
      sal.id,
      sal.date,
      sal.check_in_time,
      sal.check_out_time,
      sal.check_in_status,
      sal.minutes_late,
      s.id AS student_db_id,
      s.student_id,
      s.full_name,
      c.name AS class_name
    FROM student_attendance_logs sal
    INNER JOIN students s ON s.id = sal.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    ${where}
      AND sal.check_in_time IS NOT NULL
    ORDER BY sal.date DESC, s.full_name ASC
  `;

  const { rows } = await pool.query(sql, params);

  const formattedRows = rows.map((row) => ({
    id: row.id,
    date: row.date,
    date_display: formatDateDisplay(row.date),
    student_db_id: row.student_db_id,
    student_id: row.student_id,
    full_name: row.full_name,
    class_name: row.class_name || "—",
    check_in: row.check_in_time ? formatTime12h(new Date(row.check_in_time)) : "—",
    check_out: row.check_out_time
      ? formatTime12h(new Date(row.check_out_time))
      : "—",
    status: row.check_in_status || "—",
    minutes_late: row.minutes_late || 0,
  }));

  const summary = {
    total_present: formattedRows.length,
    on_time: formattedRows.filter((r) => r.status === "on_time").length,
    late: formattedRows.filter((r) => r.status === "late").length,
    checked_out: formattedRows.filter((r) => r.check_out !== "—").length,
  };

  if (fromDate && toDate && !classId) {
    summary.absent = null;
  } else if (fromDate && toDate && classId) {
    const absentParams = [fromDate, toDate, Number(classId)];
    let absentSql = `
      WITH dates AS (
        SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS d
      ),
      class_students AS (
        SELECT id FROM students
        WHERE "deletedAt" IS NULL AND class_id = $3
      ),
      expected AS (
        SELECT cs.id AS student_id, d.d AS date
        FROM class_students cs CROSS JOIN dates d
      )
      SELECT COUNT(*)::int AS absent_count
      FROM expected e
      LEFT JOIN student_attendance_logs sal
        ON sal.student_id = e.student_id
       AND sal.date = e.date
       AND sal.check_in_time IS NOT NULL
      WHERE sal.id IS NULL
    `;
    if (academicYearId) {
      absentParams.push(Number(academicYearId));
      absentSql = `
        WITH dates AS (
          SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS d
        ),
        class_students AS (
          SELECT id FROM students
          WHERE "deletedAt" IS NULL AND class_id = $3 AND academic_year_id = $4
        ),
        expected AS (
          SELECT cs.id AS student_id, d.d AS date
          FROM class_students cs CROSS JOIN dates d
        )
        SELECT COUNT(*)::int AS absent_count
        FROM expected e
        LEFT JOIN student_attendance_logs sal
          ON sal.student_id = e.student_id
         AND sal.date = e.date
         AND sal.check_in_time IS NOT NULL
        WHERE sal.id IS NULL
      `;
    }
    const absentResult = await pool.query(absentSql, absentParams);
    summary.absent = absentResult.rows[0]?.absent_count ?? 0;
  }

  return { rows: formattedRows, summary };
}

async function listReportClasses(academicYearId) {
  const params = [];
  let yearClause = "";
  if (academicYearId) {
    params.push(Number(academicYearId));
    yearClause = ` AND s.academic_year_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    SELECT DISTINCT c.id, c.name
    FROM classes c
    INNER JOIN students s ON s.class_id = c.id
    WHERE s."deletedAt" IS NULL
    ${yearClause}
    ORDER BY c.name ASC
  `,
    params
  );

  return rows;
}

module.exports = {
  processAttendanceScan,
  getAttendanceReport,
  listReportClasses,
  resolveStudentByQrToken,
};
