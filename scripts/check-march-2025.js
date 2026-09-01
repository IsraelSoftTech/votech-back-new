require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(user_id)::int AS with_user,
      COUNT(*) FILTER (WHERE user_id IS NULL)::int AS without_user
    FROM salaries
    WHERE paid = true AND month = 'March' AND year = 2025
  `);
  console.log("March 2025 paid:", r.rows[0]);

  const named = await pool.query(`
    SELECT s.id, s.user_id, s.amount,
      COALESCE(t.full_name, u.name, u.username) AS name
    FROM salaries s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE s.paid = true AND s.month = 'March' AND s.year = 2025
    ORDER BY s.id DESC
    LIMIT 15
  `);
  console.log(JSON.stringify(named.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
