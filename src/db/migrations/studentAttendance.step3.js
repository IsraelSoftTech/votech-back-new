"use strict";

/**
 * Checkout grace period after school end.
 */
async function run(pool, label = "student attendance step 3") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE school_hours_settings
      ADD COLUMN IF NOT EXISTS checkout_grace_minutes_after_end INTEGER NOT NULL DEFAULT 30
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label}: schema ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
