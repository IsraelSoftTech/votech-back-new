const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  user: "postgres",
  password: "postgres",
  database: "votechs7academygroup",
  port: 5432,
});

const createApplicationsTable = `
-- Applications
CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    applicant_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    applicant_name VARCHAR(100) NOT NULL,
    classes TEXT NOT NULL, -- Comma-separated class names
    subjects TEXT NOT NULL, -- Comma-separated subject names
    contact VARCHAR(50) NOT NULL,
    certificate_url VARCHAR(500),
    certificate_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_comment TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(applicant_id) -- Ensure only one application per user
);
`;

async function initializeApplicationsTable() {
  try {
    console.log("Creating applications table...");
    await pool.query(createApplicationsTable);
    console.log("Applications table created successfully!");

    // Test the table
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM applications"
    );
    console.log(`Applications table has ${result.rows[0].count} records`);
  } catch (error) {
    console.error("Error creating applications table:", error);
  } finally {
    await pool.end();
  }
}

initializeApplicationsTable();
