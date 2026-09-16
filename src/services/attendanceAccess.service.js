"use strict";

const { pool } = require("../../routes/utils");

/** Users who currently hold a live attendance grant. */
async function listAccessUsers() {
  const { rows } = await pool.query(
    `SELECT g.user_id AS id,
            u.name,
            u.username,
            u.role,
            g.granted_at,
            grantor.name AS granted_by_name
       FROM attendance_access_grants g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN users grantor ON grantor.id = g.granted_by
      WHERE g.revoked_at IS NULL
      ORDER BY u.name`
  );
  return rows;
}

async function hasAccess(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM attendance_access_grants
      WHERE user_id = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function grantAccess(userId, grantedBy) {
  const { rows } = await pool.query(
    `SELECT id, name, username, role FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  // The partial unique index makes a second live grant impossible, so a
  // repeat grant simply leaves the existing one in place.
  await pool.query(
    `INSERT INTO attendance_access_grants (user_id, granted_by)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, grantedBy]
  );

  return rows[0];
}

async function revokeAccess(userId, revokedBy) {
  const { rowCount } = await pool.query(
    `UPDATE attendance_access_grants
        SET revoked_at = NOW(), revoked_by = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, revokedBy]
  );
  return rowCount > 0;
}

module.exports = {
  listAccessUsers,
  hasAccess,
  grantAccess,
  revokeAccess,
};
