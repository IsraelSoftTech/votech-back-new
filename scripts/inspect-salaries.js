require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'salaries'
    ORDER BY ordinal_position
  `);
  console.log("Columns:", cols.rows);

  const sample = await pool.query(
    "SELECT * FROM salaries WHERE paid = true ORDER BY id DESC LIMIT 3"
  );
  console.log("Samples:", JSON.stringify(sample.rows, null, 2));

  const nullCount = await pool.query(
    "SELECT COUNT(*)::int AS total, COUNT(user_id)::int AS with_user FROM salaries WHERE paid = true"
  );
  console.log("Null user_id stats:", nullCount.rows[0]);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
