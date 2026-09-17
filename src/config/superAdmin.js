const crypto = require("crypto");
require("dotenv").config();

/**
 * The super admin is a master key, not a staff account: it owns no row of its
 * own in `users`. Signing in with it only earns the right to step into a
 * dedicated workspace account of a chosen role — never a real staff member.
 *
 * The defaults below exist so the feature works out of the box; set
 * SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD in the environment to override
 * them, or SUPER_ADMIN_ENABLED=false to switch the back door off entirely.
 */
const SUPER_ADMIN_USERNAME = (
  process.env.SUPER_ADMIN_USERNAME || "super_admin_votech"
).trim();

const SUPER_ADMIN_PASSWORD =
  process.env.SUPER_ADMIN_PASSWORD || "super_admin_password";

const SUPER_ADMIN_ENABLED =
  String(process.env.SUPER_ADMIN_ENABLED ?? "true").toLowerCase() !== "false";

/** Claim that marks a token as "signed in, but no role chosen yet". */
const ROLE_SELECTION_PURPOSE = "super-admin:role-selection";

/** How long the chooser stays usable, i.e. how long "switch role" keeps working. */
const ROLE_SELECTION_TTL = process.env.SUPER_ADMIN_TTL || "24h";

/** Length-independent, constant-time string comparison. */
function secureEquals(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

/**
 * True when the submitted username is the super admin handle. Checked before
 * the database lookup, so a real account created with the same username can
 * never shadow (or be reached through) the master credentials.
 */
function isSuperAdminUsername(username) {
  if (!SUPER_ADMIN_ENABLED || typeof username !== "string") return false;
  return secureEquals(username.trim(), SUPER_ADMIN_USERNAME);
}

function verifySuperAdminPassword(password) {
  if (!SUPER_ADMIN_ENABLED || typeof password !== "string") return false;
  return secureEquals(password, SUPER_ADMIN_PASSWORD);
}

module.exports = {
  SUPER_ADMIN_USERNAME,
  SUPER_ADMIN_ENABLED,
  ROLE_SELECTION_PURPOSE,
  ROLE_SELECTION_TTL,
  isSuperAdminUsername,
  verifySuperAdminPassword,
};
