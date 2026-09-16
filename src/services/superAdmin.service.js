const jwt = require("jsonwebtoken");
const { pool, JWT_SECRET } = require("../../routes/utils");
const {
  SUPER_ADMIN_USERNAME,
  ROLE_SELECTION_PURPOSE,
  ROLE_SELECTION_TTL,
  isSuperAdminUsername,
  verifySuperAdminPassword,
} = require("../config/superAdmin");

/**
 * Roles the chooser always offers, in the order they are shown. Any other role
 * found on real accounts is appended, so no account is ever unreachable.
 */
const KNOWN_ROLES = [
  "Admin1",
  "Admin2",
  "Admin3",
  "Admin4",
  "Teacher",
  "Discipline",
  "Psychosocialist",
];

const ROLE_DESCRIPTIONS = {
  Admin1: "Read-only oversight across the school",
  Admin2: "Finance: fees, salaries, debts and payslips",
  Admin3: "Academics: students, classes, marks and report cards",
  Admin4: "Dean: subjects, lesson plans and HODs",
  Teacher: "Classroom: marks, lesson plans and cases",
  Discipline: "Discipline cases and student attendance",
  Psychosocialist: "Counselling cases and follow-ups",
};

/**
 * Proof that the master credentials were accepted. It deliberately carries no
 * user id and no role: on its own it can do nothing but list roles and trade
 * itself for a real session, and `authenticateToken` rejects it everywhere else.
 */
function signRoleSelectionToken() {
  return jwt.sign(
    { purpose: ROLE_SELECTION_PURPOSE, username: SUPER_ADMIN_USERNAME },
    JWT_SECRET,
    { expiresIn: ROLE_SELECTION_TTL }
  );
}

function isRoleSelectionToken(decoded) {
  return Boolean(decoded) && decoded.purpose === ROLE_SELECTION_PURPOSE;
}

/** Express guard for the endpoints that only the super admin chooser may call. */
function requireRoleSelectionToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader ? authHeader.split(" ")[1] : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isRoleSelectionToken(decoded)) {
      return res
        .status(403)
        .json({ error: "Access denied. Super admin credentials required." });
    }
    req.superAdmin = decoded;
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired. Sign in again." });
    }
    return res.status(403).json({ error: "Invalid token" });
  }
}

/** Every account the super admin may step into, grouped by role. */
async function listSelectableRoles() {
  const { rows } = await pool.query(
    `SELECT id, name, username, role, email, contact
       FROM users
      WHERE COALESCE(suspended, FALSE) = FALSE
        AND role IS NOT NULL
      ORDER BY role ASC, name ASC NULLS LAST, id ASC`
  );

  const byRole = new Map(KNOWN_ROLES.map((role) => [role, []]));
  for (const row of rows) {
    if (!byRole.has(row.role)) byRole.set(row.role, []);
    byRole.get(row.role).push(row);
  }

  return [...byRole.entries()].map(([role, accounts]) => ({
    role,
    description: ROLE_DESCRIPTIONS[role] || "",
    accounts,
  }));
}

/**
 * Resolves the account a role selection lands on: the explicitly chosen one, or
 * the oldest active account holding that role.
 */
async function findAccountForRole(role, userId) {
  if (userId != null) {
    const { rows } = await pool.query(
      `SELECT * FROM users
        WHERE id = $1 AND role = $2 AND COALESCE(suspended, FALSE) = FALSE
        LIMIT 1`,
      [userId, role]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `SELECT * FROM users
      WHERE role = $1 AND COALESCE(suspended, FALSE) = FALSE
      ORDER BY id ASC
      LIMIT 1`,
    [role]
  );
  return rows[0] || null;
}

module.exports = {
  KNOWN_ROLES,
  ROLE_DESCRIPTIONS,
  isSuperAdminUsername,
  verifySuperAdminPassword,
  signRoleSelectionToken,
  isRoleSelectionToken,
  requireRoleSelectionToken,
  listSelectableRoles,
  findAccountForRole,
};
