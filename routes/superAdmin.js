const express = require("express");
const { issueUserSession } = require("../src/services/userSession.service");
const {
  requireRoleSelectionToken,
  listSelectableRoles,
  findAccountForRole,
} = require("../src/services/superAdmin.service");

const router = express.Router();

// Everything here is reachable only with the master credentials.
router.use(requireRoleSelectionToken);

/** Roles the super admin can step into, with the accounts behind each one. */
router.get("/roles", async (req, res) => {
  try {
    res.json({
      username: req.superAdmin.username,
      roles: await listSelectableRoles(),
    });
  } catch (error) {
    console.error("Super admin: failed to list roles", error);
    res.status(500).json({ error: "Could not load the available roles" });
  }
});

/**
 * Trades the role-selection token for a real session. From this point the
 * caller simply *is* that account — same token shape, same permissions.
 */
router.post("/assume", async (req, res) => {
  try {
    const role = typeof req.body?.role === "string" ? req.body.role.trim() : "";
    if (!role) {
      return res.status(400).json({ error: "A role is required" });
    }

    const rawUserId = req.body?.userId;
    let userId = null;
    if (rawUserId !== undefined && rawUserId !== null && rawUserId !== "") {
      userId = Number(rawUserId);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: "Invalid account selected" });
      }
    }

    const account = await findAccountForRole(role, userId);
    if (!account) {
      return res.status(404).json({
        error: userId
          ? "That account is no longer available for this role"
          : `No active ${role} account exists yet`,
      });
    }

    const session = await issueUserSession(account, req, {
      viaSuperAdmin: true,
    });

    console.log(
      `🔑 Super admin entered ${account.role} as ${account.username} (id ${account.id})`
    );

    res.json(session);
  } catch (error) {
    console.error("Super admin: failed to assume role", error);
    res.status(500).json({ error: "Could not enter the selected role" });
  }
});

module.exports = router;
