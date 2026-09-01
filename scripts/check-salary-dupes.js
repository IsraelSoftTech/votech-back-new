require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Same month/year/amount pairs: one with user, one without?
  const dupes = await pool.query(`
    SELECT month, year, amount,
      COUNT(*)::int AS cnt,
      COUNT(user_id)::int AS with_user
    FROM salaries
    WHERE month = 'March' AND year = 2025
    GROUP BY month, year, amount
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 10
  `);
  console.log("Duplicate amount groups:", dupes.rows);

  // Records with user_id for March 2025 (any paid status)
  const withUser = await pool.query(`
    SELECT id, user_id, amount, paid,
      COALESCE(t.full_name, u.name, u.username) AS name
    FROM salaries s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE s.month = 'March' AND s.year = 2025 AND s.user_id IS NOT NULL
    LIMIT 10
  `);
  console.log("March 2025 WITH user_id:", JSON.stringify(withUser.rows, null, 2));

  // Check change logs for salary 401
  try {
    const logs = await pool.query(`
      SELECT table_name, record_id, change_type, changed_at, fields_changed
      FROM change_logs
      WHERE table_name = 'salaries' AND record_id = 401
      ORDER BY changed_at DESC
      LIMIT 5
    `);
    console.log("Change logs for 401:", logs.rows);
  } catch (e) {
    console.log("No change_logs:", e.message);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
