const { Pool } = require("pg");
require("dotenv").config();

const isDesktop = process.env.NODE_ENV === "desktop";
const db = isDesktop
  ? process.env.DATABASE_URL_LOCAL
  : process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: db,
});

async function migrateDisciplineCases() {
  try {
    console.log("Starting discipline cases migration...");

    // Create discipline_cases table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS discipline_cases (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        case_description TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'not resolved' CHECK (status IN ('resolved', 'not resolved')),
        recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP NULL,
        resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        resolution_notes TEXT NULL
      )
    `);
    console.log("✓ discipline_cases table created");

    // Create indexes for better performance
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discipline_cases_student ON discipline_cases(student_id)"
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discipline_cases_class ON discipline_cases(class_id)"
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discipline_cases_status ON discipline_cases(status)"
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_discipline_cases_recorded_at ON discipline_cases(recorded_at)"
    );
    console.log("✓ Indexes created");

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await pool.end();
  }
}

migrateDisciplineCases();
