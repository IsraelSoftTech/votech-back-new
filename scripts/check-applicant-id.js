require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await pool.query(`
    SELECT id, user_id, applicant_id, amount, month, year, paid
    FROM salaries
    WHERE paid = true AND user_id IS NULL
    LIMIT 10
  `);
  console.log("Paid with null user_id:", JSON.stringify(r.rows, null, 2));

  const withApplicant = await pool.query(`
    SELECT COUNT(*)::int AS cnt
    FROM salaries
    WHERE paid = true AND user_id IS NULL AND applicant_id IS NOT NULL
  `);
  console.log("With applicant_id:", withApplicant.rows[0]);

  const joinApplicant = await pool.query(`
    SELECT s.id,
      s.user_id,
      s.applicant_id,
      COALESCE(t.full_name, u.name, u.username) AS via_user_id,
      COALESCE(t2.full_name, u2.name, u2.username) AS via_applicant_id
    FROM salaries s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN teachers t ON t.user_id = u.id
    LEFT JOIN users u2 ON s.applicant_id = u2.id
    LEFT JOIN teachers t2 ON t2.user_id = u2.id
    WHERE s.paid = true AND s.user_id IS NULL
    LIMIT 5
  `);
  console.log("Join test:", JSON.stringify(joinApplicant.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
