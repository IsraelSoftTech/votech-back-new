"use strict";

/**
 * Academic Year Page takedown — drop page-only tables.
 * Does NOT touch "academicYears" or any academic_year_id column.
 */
async function run(pool, label = "remove academic year page step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DROP TABLE IF EXISTS academic_year_grants`);
    await client.query(`DROP TABLE IF EXISTS academic_year_switch_logs`);

    await client.query("COMMIT");
    console.log(`✅ ${label}: page-only tables dropped`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
