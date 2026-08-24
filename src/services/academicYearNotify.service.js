"use strict";

const { pool } = require("../../routes/utils");

/**
 * Optional Step 13.4 — notify all Admin1 users via in-app message when Admin3 switches year.
 * Failures are logged and do not block the switch response.
 */
async function notifyAdmin1OfYearChange({
  performer,
  activeYear,
  archivedYear,
  action = "switch",
  reason = null,
}) {
  if (!performer || performer.role !== "Admin3") {
    return;
  }

  try {
    const adminRows = await pool.query(
      `SELECT id FROM users
       WHERE role = 'Admin1'
         AND (suspended IS NULL OR suspended = false)`
    );

    if (!adminRows.rows.length) {
      return;
    }

    const performerName =
      performer.name || performer.username || `User #${performer.id}`;
    const activeName = activeYear?.name || "unknown year";
    const archivedName = archivedYear?.name;

    let content = `[System] Academic year ${action}: ${performerName} set "${activeName}" as the active academic year.`;
    if (archivedName) {
      content += ` "${archivedName}" is now read-only.`;
    }
    if (reason) {
      content += ` Reason: ${reason}`;
    }

    for (const admin of adminRows.rows) {
      if (Number(admin.id) === Number(performer.id)) continue;

      await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content)
         VALUES ($1, $2, $3)`,
        [performer.id, admin.id, content]
      );
    }
  } catch (err) {
    console.warn("[AY notify] Failed to notify Admin1:", err.message);
  }
}

module.exports = { notifyAdmin1OfYearChange };
