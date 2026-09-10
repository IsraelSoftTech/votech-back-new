function noneAssignment() {
  return {
    hod_status: "none",
    is_hod: false,
    hod_id: null,
    department_name: null,
    department_id: null,
    suspended: false,
  };
}

function toAssignment(row) {
  if (!row) return noneAssignment();
  const suspended = row.suspended === true || row.suspended === "t";
  const hod_status = suspended ? "suspended" : "active";
  return {
    hod_status,
    is_hod: hod_status === "active",
    hod_id: row.hod_id || row.id || null,
    department_name: row.department_name || null,
    department_id: row.department_id || null,
    suspended,
  };
}

async function getHodAssignment(pool, userId) {
  if (!userId) return noneAssignment();
  const { rows } = await pool.query(
    `
    SELECT
      h.id AS hod_id,
      h.department_name,
      h.suspended,
      h.hod_user_id,
      s.id AS department_id
    FROM hods h
    LEFT JOIN specialties s
      ON LOWER(TRIM(s.name)) = LOWER(TRIM(h.department_name))
    WHERE h.hod_user_id = $1
    ORDER BY h.updated_at DESC NULLS LAST, h.id DESC
    LIMIT 1
    `,
    [userId]
  );
  return toAssignment(rows[0]);
}

function notifyHodUser(userId, assignment) {
  if (!userId) return;
  try {
    const { emitToUser } = require("../desktop-module/socket");
    emitToUser(userId, "hodStatusUpdate", assignment || noneAssignment());
  } catch (_) {
    // Sockets are optional; REST polling still updates the account.
  }
}

async function syncHodUserStatus(pool, userId) {
  const assignment = await getHodAssignment(pool, userId);
  notifyHodUser(userId, assignment);
  return assignment;
}

module.exports = {
  noneAssignment,
  toAssignment,
  getHodAssignment,
  notifyHodUser,
  syncHodUserStatus,
};
