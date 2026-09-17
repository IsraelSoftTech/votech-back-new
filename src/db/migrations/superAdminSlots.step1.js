"use strict";

/**
 * Dedicated super-admin workspace accounts: one free `users` row per role
 * that the master login always steps into, instead of impersonating staff.
 */
async function run(pool, label = "super admin slots step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_is_system
        ON users (is_system)
      WHERE is_system = TRUE
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
