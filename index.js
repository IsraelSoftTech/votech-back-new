process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

require("dotenv").config();
const { pool } = require("./routes/utils");
const { createServer } = require("http");
const { initSockets } = require("./src/desktop-module/socket/index");
const app = require("./app");

const basePort = parseInt(process.env.PORT || "5000", 10);
const { exec } = require("child_process");
const {
  cleanStaleSessions,
} = require("./src/desktop-module/utils/sync.cleanup");

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_inventory (
        id SERIAL PRIMARY KEY,
        item_name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(20) NOT NULL CHECK (category IN ('income', 'expenditure')),
        uom VARCHAR(50) NOT NULL CHECK (uom IN ('Pieces', 'Kg', 'Liters', 'Cartons')),
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_cost_price NUMERIC(12,2) NOT NULL,
        depreciation_rate NUMERIC(5,2),
        supplier VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_inventory_heads (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS head_id INTEGER REFERENCES report_inventory_heads(id) ON DELETE SET NULL
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS support_doc VARCHAR(100)
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS item_id VARCHAR(20) UNIQUE
    `);
    await pool
      .query(
        `
      ALTER TABLE report_inventory ALTER COLUMN quantity DROP NOT NULL
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory DROP CONSTRAINT IF EXISTS report_inventory_uom_check
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory DROP CONSTRAINT IF EXISTS report_inventory_uom_check
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory ADD CONSTRAINT report_inventory_uom_check
      CHECK (uom IN ('Pieces', 'Kg', 'Liters', 'Cartons', 'Others'))
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2)
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      UPDATE report_inventory SET amount = unit_cost_price * COALESCE(quantity, 1) WHERE amount IS NULL
    `
      )
      .catch(() => {});
    const { rows: needBackfill } = await pool.query(
      "SELECT id, item_name FROM report_inventory WHERE item_id IS NULL ORDER BY id"
    );
    for (const row of needBackfill) {
      const prefix =
        (row.item_name || "XX")
          .slice(0, 2)
          .toUpperCase()
          .replace(/[^A-Z]/g, "X") || "XX";
      const { rows: existing } = await pool.query(
        "SELECT item_id FROM report_inventory WHERE item_id LIKE $1 ORDER BY item_id DESC LIMIT 1",
        [prefix + "%"]
      );
      let nextNum = 1;
      if (existing.length) {
        const m = existing[0].item_id?.match(/(\d+)$/);
        if (m) nextNum = parseInt(m[1], 10) + 1;
      }
      const itemId = prefix + String(nextNum).padStart(3, "0");
      await pool.query(
        "UPDATE report_inventory SET item_id = $1 WHERE id = $2",
        [itemId, row.id]
      );
    }
    console.log("✅ report_inventory table ready");
  } catch (err) {
    console.warn("⚠️ Migration (report_inventory):", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_equipment (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cost NUMERIC(12,2) NOT NULL,
        department_location VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool
      .query(
        `
      ALTER TABLE property_equipment DROP CONSTRAINT IF EXISTS property_equipment_department_location_check
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE property_equipment ALTER COLUMN department_location TYPE VARCHAR(50)
    `
      )
      .catch(() => {});
    console.log("✅ property_equipment table ready");
  } catch (err) {
    console.warn("⚠️ Migration (property_equipment):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE students ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    `);
    await pool
      .query(
        `
      ALTER TABLE students ADD CONSTRAINT students_status_check
      CHECK (status IN ('active', 'graduated', 'withdrawn'))
    `
      )
      .catch(() => {});
    console.log("✅ students.status column ready");
  } catch (err) {
    console.warn("⚠️ Migration (students.status):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE promotion_run_lock ADD COLUMN IF NOT EXISTS year_switch_in_progress BOOLEAN NOT NULL DEFAULT false
    `);
    console.log("✅ promotion_run_lock.year_switch_in_progress column ready");
  } catch (err) {
    console.warn("⚠️ Migration (promotion_run_lock.year_switch_in_progress):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE promotion_requirements ADD COLUMN IF NOT EXISTS promotion_mode VARCHAR(20) NOT NULL DEFAULT 'single'
    `);
    await pool
      .query(
        `
      ALTER TABLE promotion_requirements ADD CONSTRAINT promotion_requirements_promotion_mode_check
      CHECK (promotion_mode IN ('single', 'split'))
    `
      )
      .catch(() => {});
    await pool.query(`
      ALTER TABLE promotion_requirements ADD COLUMN IF NOT EXISTS decision_mode VARCHAR(20) NOT NULL DEFAULT 'automatic'
    `);
    await pool
      .query(
        `
      ALTER TABLE promotion_requirements ADD CONSTRAINT promotion_requirements_decision_mode_check
      CHECK (decision_mode IN ('automatic', 'manual'))
    `
      )
      .catch(() => {});
    console.log("✅ promotion_requirements.promotion_mode/decision_mode columns ready");
  } catch (err) {
    console.warn("⚠️ Migration (promotion_requirements split/manual columns):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE promotion_run_moves ADD COLUMN IF NOT EXISTS manual_decisions JSONB
    `);
    await pool.query(`
      ALTER TABLE promotion_run_moves ADD COLUMN IF NOT EXISTS destination_overrides JSONB
    `);
    console.log("✅ promotion_run_moves.manual_decisions/destination_overrides columns ready");
  } catch (err) {
    console.warn("⚠️ Migration (promotion_run_moves split/manual columns):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_orientation BOOLEAN NOT NULL DEFAULT false
    `);
    // One-time backfill for the two orientation classes that already
    // exist today, identified by name since the flag itself didn't exist
    // yet when they were created. Going forward the flag (set explicitly
    // at class-creation time) is the only source of truth, this only
    // ever needs to touch rows that predate it — it's a no-op once
    // they're flagged.
    await pool.query(`
      UPDATE classes SET is_orientation = true
      WHERE is_orientation = false AND name ILIKE '%orientation%'
    `);
    console.log("✅ classes.is_orientation column ready (existing Orientation classes backfilled)");
  } catch (err) {
    console.warn("⚠️ Migration (classes.is_orientation):", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_department_choices (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        department_id INTEGER NOT NULL REFERENCES specialties(id),
        "rank" INTEGER NOT NULL CHECK ("rank" BETWEEN 1 AND 6),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (student_id, "rank"),
        UNIQUE (student_id, department_id)
      )
    `);
    console.log("✅ student_department_choices table ready");
  } catch (err) {
    console.warn("⚠️ Migration (student_department_choices):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS orientation_department_id INTEGER REFERENCES specialties(id)
    `);
    // Deliberately no backfill — admins tag these explicitly on the
    // Subjects page, there's no reliable existing signal to infer from.
    console.log("✅ subjects.orientation_department_id column ready");
  } catch (err) {
    console.warn("⚠️ Migration (subjects.orientation_department_id):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE students ADD COLUMN IF NOT EXISTS is_repeating BOOLEAN NOT NULL DEFAULT false
    `);
    console.log("✅ students.is_repeating column ready");
  } catch (err) {
    console.warn("⚠️ Migration (students.is_repeating):", err.message);
  }

  try {
    await pool.query(`
      ALTER TABLE student_promotions ADD COLUMN IF NOT EXISTS was_repeating BOOLEAN NOT NULL DEFAULT false
    `);
    // Captures whether the student was already repeating *before* this
    // particular move, so reversing the move can restore is_repeating to
    // exactly what it was, not just flip it off.
    console.log("✅ student_promotions.was_repeating column ready");
  } catch (err) {
    console.warn("⚠️ Migration (student_promotions.was_repeating):", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS academic_year_grants (
        id SERIAL PRIMARY KEY,
        academic_year_id INTEGER NOT NULL REFERENCES "academicYears"(id),
        granted_by INTEGER NOT NULL REFERENCES users(id),
        is_global BOOLEAN NOT NULL DEFAULT false,
        admin3_user_ids INTEGER[] NOT NULL DEFAULT '{}',
        reason TEXT,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS academic_year_grants_academic_year_id_idx ON academic_year_grants (academic_year_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS academic_year_grants_granted_by_idx ON academic_year_grants (granted_by)
    `);
    console.log("✅ academic_year_grants table ready");
  } catch (err) {
    console.warn("⚠️ Migration (academic_year_grants):", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        school_name VARCHAR(200) NOT NULL DEFAULT 'Votech S7 Academy',
        principal_name VARCHAR(200) NOT NULL DEFAULT '',
        contact_phone VARCHAR(50),
        contact_email VARCHAR(150),
        address VARCHAR(250),
        motto VARCHAR(250),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT school_settings_single_row CHECK (id = 1)
      )
    `);
    // Seeded once with the values every document generator already
    // hardcoded, so switching them over to read this table is a no-op
    // until someone actually changes it via the settings page.
    await pool.query(`
      INSERT INTO school_settings (id, school_name, principal_name, motto)
      VALUES (1, 'Votech S7 Academy', 'Mr. Thomas Ambe', 'Welfare, Productivity, Self Actualization')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log("✅ school_settings table ready");
  } catch (err) {
    console.warn("⚠️ Migration (school_settings):", err.message);
  }

  try {
    // class_subjects had no year at all — a teacher reassignment silently
    // overwrote the only row that existed, so every past report card
    // showed whoever teaches it NOW when regenerated. Existing rows are
    // backfilled to the CURRENT active year, that's the only year this
    // data can be trusted for; assignment history before this migration
    // was never recorded and can't be recovered.
    await pool.query(`
      ALTER TABLE class_subjects ADD COLUMN IF NOT EXISTS academic_year_id INTEGER REFERENCES "academicYears"(id)
    `);
    await pool.query(`
      UPDATE class_subjects
      SET academic_year_id = (SELECT id FROM "academicYears" WHERE status = 'active' LIMIT 1)
      WHERE academic_year_id IS NULL
    `);
    await pool.query(`
      ALTER TABLE class_subjects ALTER COLUMN academic_year_id SET NOT NULL
    `);
    // The table actually carries THREE overlapping unique indexes from
    // earlier migrations (department-scoped, teacher-scoped, and a
    // duplicate of the teacher-scoped one), none of them year-aware. Left
    // in place, unique_class_subject_teacher alone would block the most
    // common case going forward: the same teacher teaching the same
    // class+subject again in a new year. Replaced with one clean,
    // year-scoped index. The first two are real table CONSTRAINTS (not
    // plain indexes), Postgres needs DROP CONSTRAINT for those.
    await pool.query(`ALTER TABLE class_subjects DROP CONSTRAINT IF EXISTS unique_class_subject_department`);
    await pool.query(`ALTER TABLE class_subjects DROP CONSTRAINT IF EXISTS unique_class_subject_teacher`);
    await pool.query(`DROP INDEX IF EXISTS class_subjects_unique_idx`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS unique_class_subject_department_year
      ON class_subjects (academic_year_id, class_id, subject_id, department_id)
    `);
    console.log("✅ class_subjects.academic_year_id column ready (backfilled + re-indexed)");
  } catch (err) {
    console.warn("⚠️ Migration (class_subjects.academic_year_id):", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_master_assignments (
        id SERIAL PRIMARY KEY,
        academic_year_id INTEGER NOT NULL REFERENCES "academicYears"(id),
        class_id INTEGER NOT NULL REFERENCES classes(id),
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (academic_year_id, class_id)
      )
    `);
    // Backfill from whatever classes.class_master_id already holds today,
    // tagged to the current active year — same "only the current year is
    // trustworthy" reasoning as class_subjects above.
    await pool.query(`
      INSERT INTO class_master_assignments (academic_year_id, class_id, teacher_id)
      SELECT (SELECT id FROM "academicYears" WHERE status = 'active' LIMIT 1), id, class_master_id
      FROM classes
      WHERE class_master_id IS NOT NULL
      ON CONFLICT (academic_year_id, class_id) DO NOTHING
    `);
    console.log("✅ class_master_assignments table ready (backfilled from classes.class_master_id)");
  } catch (err) {
    console.warn("⚠️ Migration (class_master_assignments):", err.message);
  }
}

function killPort(port) {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "win32"
        ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`
        : `lsof -ti tcp:${port} | xargs kill -9`;
    exec(cmd, (err) => {
      if (err) console.warn(`Port ${port} cleanup warning:`, err.message);
      else console.log(`Cleaned any processes on port ${port}`);
      resolve();
    });
  });
}

async function startOnce(port) {
  await runMigrations();
  await killPort(port);

  const server = createServer(app);
  initSockets(server);

  const { startWatchdog } = require("./src/controllers/promotion.controller");
  startWatchdog();

  const { startReportCardWatchdog } = require("./src/controllers/reportCardSession.controller");
  startReportCardWatchdog();

  const { startQpdfWatchdog } = require("./scripts/ensureQpdf");
  startQpdfWatchdog();

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Failed to bind to port ${port}: address in use`);
    } else {
      console.error("Failed to start server:", err);
    }
    process.exit(1);
  });
}

startOnce(basePort).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

console.log("🚀 Starting Votech Backend Server...");
console.log("📊 Database: PostgreSQL");
console.log("🔐 Authentication: JWT");
console.log("📁 File Storage: FTP + Local");
setInterval(cleanStaleSessions, 90 * 1000);
