"use strict";

/**
 * Point 6 — Step 1.2 & 1.3: student attendance logs + school hours settings.
 */
async function run(pool, label = "student attendance step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_attendance_logs (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        check_in_time TIMESTAMPTZ,
        check_out_time TIMESTAMPTZ,
        check_in_status VARCHAR(20) CHECK (check_in_status IN ('on_time', 'late')),
        minutes_late INTEGER NOT NULL DEFAULT 0,
        academic_year_id INTEGER REFERENCES "academicYears"(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (student_id, date)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_attendance_logs_date
        ON student_attendance_logs (date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_attendance_logs_student
        ON student_attendance_logs (student_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_attendance_logs_year_date
        ON student_attendance_logs (academic_year_id, date)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS school_hours_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        school_start_time TIME NOT NULL DEFAULT '07:30:00',
        school_end_time TIME NOT NULL DEFAULT '17:00:00',
        timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Douala',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await client.query(`
      INSERT INTO school_hours_settings (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label}: schema ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
