"use strict";

/**
 * Point 4B — Salary Payslip: snapshot amounts at payment time so later edits
 * to other months never alter generated payslips.
 */
async function run(pool, label = "salary payslip step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE salaries
        ADD COLUMN IF NOT EXISTS snapshot_amount NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS payslip_locked BOOLEAN NOT NULL DEFAULT false
    `);

    await client.query(`
      UPDATE salaries
      SET snapshot_amount = amount,
          payslip_locked = true
      WHERE paid = true
        AND (snapshot_amount IS NULL OR payslip_locked IS DISTINCT FROM true)
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label}: payslip snapshot columns ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
