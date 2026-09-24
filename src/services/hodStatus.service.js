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
  const { getActiveYear } = require("./activeAcademicYear.service");
  const active = await getActiveYear();
  const yearId = active?.id ?? -1;
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
    WHERE h.hod_user_id = $1 AND h.academic_year_id = $2
    ORDER BY h.updated_at DESC NULLS LAST, h.id DESC
    LIMIT 1
    `,
    [userId, yearId]
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

const HOD_NOTICE = {
  appointed: (department) =>
    `You have been appointed Head of Department${
      department ? ` for ${department}` : ""
    }. Your account now shows HOD status, and department lesson plans are available from your menu.`,
  removed: (department) =>
    `You have been removed as Head of Department${
      department ? ` for ${department}` : ""
    }. HOD status has been cleared from your account.`,
  suspended: (department) =>
    `Your Head of Department assignment${
      department ? ` for ${department}` : ""
    } has been suspended. Department lesson plan access is blocked until you are reactivated.`,
  reactivated: (department) =>
    `Your Head of Department assignment${
      department ? ` for ${department}` : ""
    } is active again.`,
};

async function notifyHodAccount(pool, { userId, senderId, kind, departmentName }) {
  const build = HOD_NOTICE[kind];
  if (!userId || !build) return;
  const sender = Number(senderId);
  const receiver = Number(userId);
  if (!sender || sender === receiver) return;

  try {
    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content)
       VALUES ($1, $2, $3)`,
      [sender, receiver, `[HOD] ${build(departmentName || "")}`]
    );
  } catch (err) {
    console.warn("[HOD notify] Failed to notify account:", err.message);
  }
}

module.exports = {
  noneAssignment,
  toAssignment,
  getHodAssignment,
  notifyHodUser,
  syncHodUserStatus,
  notifyHodAccount,
};
