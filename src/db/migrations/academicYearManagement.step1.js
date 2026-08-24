"use strict";

/**
 * Point 7 — Step 1: Academic Year Management schema & audit tables.
 * Idempotent: safe to run on every server start.
 */

async function run(pool, label = "academic year management step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1.2 Extend academicYears ───────────────────────────────────────────
    await client.query(`
      ALTER TABLE "academicYears"
        ADD COLUMN IF NOT EXISTS switched_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS switched_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS reactivated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS is_locked_for_editing BOOLEAN NOT NULL DEFAULT false
    `);

    // Backfill lock flag from current status
    await client.query(`
      UPDATE "academicYears"
      SET is_locked_for_editing = (status = 'archived')
      WHERE is_locked_for_editing IS DISTINCT FROM (status = 'archived')
    `);

    // If multiple active years exist, archive all but the newest (by id)
    await client.query(`
      WITH ranked_active AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY id DESC) AS rn
        FROM "academicYears"
        WHERE status = 'active'
          AND "deletedAt" IS NULL
      )
      UPDATE "academicYears" ay
      SET status = 'archived',
          is_locked_for_editing = true
      FROM ranked_active ra
      WHERE ay.id = ra.id
        AND ra.rn > 1
    `);

    // ── 1.3 academic_year_switch_logs ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS academic_year_switch_logs (
        id SERIAL PRIMARY KEY,
        from_year_id INTEGER REFERENCES "academicYears"(id) ON DELETE SET NULL,
        to_year_id INTEGER REFERENCES "academicYears"(id) ON DELETE SET NULL,
        action VARCHAR(20) NOT NULL
          CHECK (action IN ('switch', 'reactivate', 'archive')),
        performed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason TEXT,
        ip_address VARCHAR(45)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ay_switch_logs_performed_at
        ON academic_year_switch_logs (performed_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ay_switch_logs_to_year
        ON academic_year_switch_logs (to_year_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ay_switch_logs_from_year
        ON academic_year_switch_logs (from_year_id)
    `);

    // ── 1.4 At most one active academic year (non-deleted rows) ────────────
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_single_active
        ON "academicYears" (status)
        WHERE status = 'active' AND "deletedAt" IS NULL
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label} migration applied`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
