"use strict";

/**
 * Per-user attendance access. Admin3 grants a user the attendance page from
 * the attendance Settings tab; a row with revoked_at IS NULL means the grant
 * is live. Revoked rows are kept for audit rather than deleted.
 */
async function run(pool, label = "student attendance step 4") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_access_grants (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // At most one live grant per user, so re-granting is a harmless no-op.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS attendance_access_grants_live_user_idx
        ON attendance_access_grants (user_id)
        WHERE revoked_at IS NULL
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
