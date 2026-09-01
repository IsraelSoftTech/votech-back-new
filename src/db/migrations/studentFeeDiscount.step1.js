"use strict";

/**
 * Point 4C — Student fee discounts (per-student, persisted, audit-friendly).
 */
async function run(pool, label = "student fee discount step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_fee_discounts (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        academic_year_id INTEGER,
        discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        reason TEXT,
        set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT student_fee_discounts_amount_non_negative CHECK (discount_amount >= 0)
      )
    `);

    const ayTable = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'academicYears'
      LIMIT 1
    `);
    if (ayTable.rows.length) {
      await client.query(`
        ALTER TABLE student_fee_discounts DROP CONSTRAINT IF EXISTS student_fee_discounts_academic_year_id_fkey
      `);
      await client.query(`
        ALTER TABLE student_fee_discounts
          ADD CONSTRAINT student_fee_discounts_academic_year_id_fkey
          FOREIGN KEY (academic_year_id) REFERENCES "academicYears"(id) ON DELETE CASCADE
      `).catch((err) => {
        if (err.code !== "42710") throw err;
      });
    }

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_student_fee_discounts_student_year
      ON student_fee_discounts (student_id, academic_year_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_fee_discounts_student_id
      ON student_fee_discounts (student_id)
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
