require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const q = `
    SELECT 
      s.id,
      s.user_id,
      s.amount,
      s.month,
      s.year,
      COALESCE(t.full_name, u.name, u.username) as user_name,
      COALESCE(t.contact, u.email, u.contact, '') as contact,
      COALESCE(t.classes, '') as classes,
      COALESCE(t.subjects, '') as subjects,
      u.id as matched_user_id,
      t.id as matched_teacher_id,
      t.user_id as teacher_user_id
    FROM salaries s
    LEFT JOIN teachers t ON s.user_id = t.user_id
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.paid = true
    ORDER BY s.paid_at DESC
    LIMIT 5
  `;
  const result = await pool.query(q);
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
