"use strict";

/**
 * Point 4B — Payslip employee snapshot: store name/contact at payment time
 * so pay slips remain correct even if user_id is later lost.
 */
async function run(pool, label = "salary payslip step 2") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE salaries
        ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS employee_contact VARCHAR(100),
        ADD COLUMN IF NOT EXISTS employee_classes VARCHAR(255),
        ADD COLUMN IF NOT EXISTS employee_subjects VARCHAR(255)
    `);

    await client.query(`
      UPDATE salaries s
      SET
        employee_name = COALESCE(
          NULLIF(TRIM(s.employee_name), ''),
          NULLIF(TRIM(t.full_name), ''),
          NULLIF(TRIM(u.name), ''),
          NULLIF(TRIM(u.username), '')
        ),
        employee_contact = COALESCE(
          NULLIF(TRIM(s.employee_contact), ''),
          NULLIF(TRIM(t.contact), ''),
          NULLIF(TRIM(u.contact), ''),
          NULLIF(TRIM(u.email), '')
        ),
        employee_classes = COALESCE(
          NULLIF(TRIM(s.employee_classes), ''),
          NULLIF(TRIM(t.classes), '')
        ),
        employee_subjects = COALESCE(
          NULLIF(TRIM(s.employee_subjects), ''),
          NULLIF(TRIM(t.subjects), '')
        )
      FROM users u
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE s.user_id = u.id
        AND s.paid = true
        AND (
          s.employee_name IS NULL OR TRIM(s.employee_name) = ''
        )
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label}: employee snapshot columns ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
