require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await pool.query(`
    SELECT id, month, year, amount, user_id, paid
    FROM salaries
    WHERE id BETWEEN 1 AND 20
    ORDER BY id
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch(console.error);
