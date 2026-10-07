"use strict";

/**
 * Stamp operational tables with academic_year_id so archived years hide
 * their records. Catalog tables are intentionally omitted: departments,
 * classes, subjects, users (and specialties / teachers as identity).
 */

const TABLES = [
  "fees",
  "events",
  "cases",
  "case_sessions",
  "case_reports",
  "discipline_cases",
  "teacher_discipline_cases",
  "lesson_plans",
  "lessons",
  "salaries",
  "salary_descriptions",
  "timetables",
  "timetable_configs",
  "teacher_assignments",
  "hods",
  "hod_teachers",
  "report_inventory",
  "report_inventory_heads",
  "property_equipment",
  "financial_transactions",
  "staff_attendance_records",
  "staff_employment_status",
  "attendance_sessions",
  "attendance_records",
  "user_guides",
  "inventory",
  "asset_depreciation",
  "debts",
  "student_attendance_logs",
];

const DATE_COLUMNS = [
  "created_at",
  "createdAt",
  "submitted_at",
  "paid_at",
  "event_date",
  "recorded_at",
  "date",
  "issued_at",
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function firstExistingDateColumn(client, table) {
  for (const col of DATE_COLUMNS) {
    if (await columnExists(client, table, col)) return col;
  }
  return null;
}

async function run(pool, label = "year-scope operational data step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const table of TABLES) {
      if (!(await tableExists(client, table))) continue;

      await client.query(
        `ALTER TABLE ${table}
           ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES "academicYears"(id) ON DELETE SET NULL`
      );

      const dateCol = await firstExistingDateColumn(client, table);
      if (dateCol) {
        await client.query(
          `UPDATE ${table} t
           SET academic_year_id = ay.id
           FROM "academicYears" ay
           WHERE t.academic_year_id IS NULL
             AND ay."deletedAt" IS NULL
             AND t.${dateCol}::date BETWEEN ay.start_date AND ay.end_date`
        );
      }

      await client.query(
        `UPDATE ${table}
         SET academic_year_id = (
           SELECT id FROM "academicYears"
           WHERE status = 'active' AND "deletedAt" IS NULL
           ORDER BY id DESC LIMIT 1
         )
         WHERE academic_year_id IS NULL`
      );

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${table}_academic_year_id ON ${table} (academic_year_id)`
      );
    }

    if (await tableExists(client, "timetables")) {
      await client.query(
        `ALTER TABLE timetables DROP CONSTRAINT IF EXISTS timetables_class_id_key`
      );
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS timetables_class_year_uidx
          ON timetables (class_id, academic_year_id)
      `);
    }

    if (await tableExists(client, "teacher_assignments")) {
      await client.query(
        `ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_teacher_id_class_id_subject_id_key`
      );
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS teacher_assignments_teacher_class_subject_year_uidx
          ON teacher_assignments (teacher_id, class_id, subject_id, academic_year_id)
      `);
    }

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
