require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const pairs = await pool.query(`
    SELECT
      m.id AS march_id,
      m.amount AS march_amount,
      m.user_id AS march_user_id,
      f.id AS feb_id,
      f.user_id AS feb_user_id,
      f.amount AS feb_amount,
      COALESCE(t.full_name, u.name, u.username) AS feb_name
    FROM salaries m
    LEFT JOIN salaries f ON f.id = m.id - 1
      AND f.month = 'February'
      AND f.year = m.year
    LEFT JOIN users u ON u.id = f.user_id
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE m.month = 'March'
      AND m.year = 2025
      AND m.paid = true
      AND m.user_id IS NULL
    ORDER BY m.id
    LIMIT 20
  `);
  console.log("March orphan vs id-1 February:", JSON.stringify(pairs.rows, null, 2));

  const idMinus2 = await pool.query(`
    SELECT m.id, m.amount, j.user_id, j.month AS prev_month,
      COALESCE(t.full_name, u.name, u.username) AS name
    FROM salaries m
    JOIN salaries j ON j.user_id IS NOT NULL
      AND j.year = m.year
      AND j.id BETWEEN m.id - 11 AND m.id - 1
    LEFT JOIN users u ON u.id = j.user_id
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE m.month = 'March' AND m.year = 2025 AND m.paid = true AND m.user_id IS NULL
    ORDER BY m.id, j.id DESC
    LIMIT 30
  `);
  console.log("\nNearby rows with user_id:", JSON.stringify(idMinus2.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
