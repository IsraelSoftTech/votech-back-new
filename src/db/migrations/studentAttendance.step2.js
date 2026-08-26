"use strict";

/**
 * Point 6 — attendance settings: check-in window + checkout rules.
 */
async function run(pool, label = "student attendance step 2") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE school_hours_settings
      ADD COLUMN IF NOT EXISTS check_in_opens_at TIME NOT NULL DEFAULT '06:00:00'
    `);
    await client.query(`
      ALTER TABLE school_hours_settings
      ADD COLUMN IF NOT EXISTS allow_checkout_before_end BOOLEAN NOT NULL DEFAULT false
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
