"use strict";

/**
 * Point 6 — ID card official stamp image.
 */

async function run(pool, label = "student id cards step 3") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE id_card_settings
        ADD COLUMN IF NOT EXISTS stamp_url TEXT
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label}: stamp_url ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
