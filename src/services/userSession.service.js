const jwt = require("jsonwebtoken");
const {
  pool,
  logUserActivity,
  createUserSession,
  getIpAddress,
  getUserAgent,
  JWT_SECRET,
} = require("../../routes/utils");
const { getActiveYear } = require("./activeAcademicYear.service");
const { getHodAssignment } = require("./hodStatus.service");

/**
 * Builds the signed-in session for a `users` row: the JWT plus the user object
 * the frontend stores as `authUser`. Shared by the normal login and by the
 * super admin stepping into a role, so both produce byte-identical sessions.
 *
 * `viaSuperAdmin` only changes the audit trail and adds a marker the UI uses to
 * offer "switch role"; the resulting session has exactly the rights of the role.
 */
async function issueUserSession(user, req, { viaSuperAdmin = false } = {}) {
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      ...(viaSuperAdmin ? { sa: true } : {}),
    },
    JWT_SECRET,
    { expiresIn: "24h" }
  );

  const ipAddress = getIpAddress(req);
  const userAgent = getUserAgent(req);
  await logUserActivity(
    user.id,
    "login",
    viaSuperAdmin
      ? `Super admin signed in as ${user.username} (${user.role})`
      : "User logged in successfully",
    null,
    null,
    null,
    ipAddress,
    userAgent
  );

  await createUserSession(user.id, ipAddress, userAgent);

  let activeYearId = null;
  try {
    const activeYear = await getActiveYear();
    activeYearId = activeYear?.id ?? null;
  } catch (activeYearError) {
    console.warn(
      "Login: could not resolve active academic year",
      activeYearError.message
    );
  }

  let hodAssignment = {
    hod_status: "none",
    is_hod: false,
    hod_id: null,
    hod_department_name: null,
    hod_department_id: null,
  };
  try {
    const hod = await getHodAssignment(pool, user.id);
    hodAssignment = {
      hod_status: hod.hod_status,
      is_hod: hod.is_hod,
      hod_id: hod.hod_id,
      hod_department_name: hod.department_name,
      hod_department_id: hod.department_id,
    };
  } catch (hodError) {
    console.warn("Login: could not resolve HOD status", hodError.message);
  }

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      contact: user.contact,
      email: user.email,
      active_year_id: activeYearId,
      ...hodAssignment,
      ...(viaSuperAdmin ? { is_super_admin: true } : {}),
    },
  };
}

module.exports = { issueUserSession };
