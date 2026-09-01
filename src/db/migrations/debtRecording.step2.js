"use strict";

/**
 * Point 4A — Debt Recording: point academic_year_id at "academicYears" (v1 API table),
 * not legacy academic_years.
 */
async function run(pool, label = "debt recording step 2") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE debts DROP CONSTRAINT IF EXISTS debts_academic_year_id_fkey
    `);

    const tableCheck = await client.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'academicYears'
      LIMIT 1
    `);

    if (tableCheck.rows.length) {
      await client.query(`
        ALTER TABLE debts
          ADD CONSTRAINT debts_academic_year_id_fkey
          FOREIGN KEY (academic_year_id) REFERENCES "academicYears"(id) ON DELETE SET NULL
      `).catch((err) => {
        if (err.code !== "42710") throw err;
      });
    }

    await client.query("COMMIT");
    console.log(`✅ ${label}: academic year FK aligned`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
