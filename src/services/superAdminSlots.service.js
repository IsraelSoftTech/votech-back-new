"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../../routes/utils");

/**
 * One dedicated workspace account per role. Super admin always steps into
 * these, never into a real staff member's row.
 */
const SLOT_ACCOUNTS = [
  { role: "Admin1", username: "votech_sa_admin1", name: "VOTECH Admin1" },
  { role: "Admin2", username: "votech_sa_admin2", name: "VOTECH Admin2" },
  { role: "Admin3", username: "votech_sa_admin3", name: "VOTECH Admin3" },
  { role: "Admin4", username: "votech_sa_admin4", name: "VOTECH Admin4" },
  { role: "Teacher", username: "votech_sa_teacher", name: "VOTECH Teacher" },
  { role: "Discipline", username: "votech_sa_discipline", name: "VOTECH Discipline" },
  { role: "Psychosocialist", username: "votech_sa_psychosocialist", name: "VOTECH Psychosocialist" },
];

const SLOT_USERNAMES = new Set(SLOT_ACCOUNTS.map((slot) => slot.username.toLowerCase()));

/** SQL fragment that hides super-admin workspaces from staff lists and counts. */
const NOT_SYSTEM_SQL = "COALESCE(is_system, FALSE) = FALSE";

function isSystemUsername(username) {
  if (typeof username !== "string") return false;
  return SLOT_USERNAMES.has(username.trim().toLowerCase());
}

function isSystemUser(user) {
  if (!user) return false;
  return Boolean(user.is_system) || isSystemUsername(user.username);
}

async function insertSlot(slot) {
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 8);
  const values = [slot.name, slot.username, passwordHash, slot.role];
  try {
    const result = await pool.query(
      `INSERT INTO users (name, username, password, role, is_system, suspended)
       VALUES ($1, $2, $3, $4, TRUE, FALSE)
       RETURNING id`,
      values
    );
    return result.rows[0];
  } catch (err) {
    if (err.code !== "42703" && err.code !== "23502") throw err;
    const result = await pool.query(
      `INSERT INTO users (name, username, password, role, is_system, suspended, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, TRUE, FALSE, NOW(), NOW())
       RETURNING id`,
      values
    );
    return result.rows[0];
  }
}

/**
 * Makes sure every known role has exactly one `is_system` workspace account.
 * Safe to run on every boot.
 */
async function ensureSuperAdminSlots() {
  for (const slot of SLOT_ACCOUNTS) {
    const byRole = await pool.query(
      `SELECT id, username, role, suspended
         FROM users
        WHERE COALESCE(is_system, FALSE) = TRUE
          AND role = $1
        ORDER BY id ASC
        LIMIT 1`,
      [slot.role]
    );

    if (byRole.rows.length) {
      const row = byRole.rows[0];
      if (row.suspended) {
        await pool.query(
          `UPDATE users SET suspended = FALSE, name = COALESCE(NULLIF(btrim(name), ''), $2)
            WHERE id = $1`,
          [row.id, slot.name]
        );
      }
      continue;
    }

    const byUsername = await pool.query(
      `SELECT id, is_system FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [slot.username]
    );

    if (byUsername.rows.length) {
      const row = byUsername.rows[0];
      if (row.is_system) {
        await pool.query(
          `UPDATE users
              SET role = $2, name = COALESCE(NULLIF(btrim(name), ''), $3),
                  is_system = TRUE, suspended = FALSE
            WHERE id = $1`,
          [row.id, slot.role, slot.name]
        );
        continue;
      }
      const fallback = `${slot.username}_${crypto.randomBytes(3).toString("hex")}`;
      await insertSlot({ ...slot, username: fallback });
      continue;
    }

    await insertSlot(slot);
  }
}

module.exports = {
  SLOT_ACCOUNTS,
  NOT_SYSTEM_SQL,
  isSystemUsername,
  isSystemUser,
  ensureSuperAdminSlots,
};
