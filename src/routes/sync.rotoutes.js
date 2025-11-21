const express = require("express");

const syncControllers = require("../controllers/contextSwitch.controller");
const authControllers = require("../controllers/auth.controller");

const bcrypt = require("bcryptjs");

async function verifySyncKey(req, res, next) {
  try {
    const providedKey = req.headers["sync-key"];
    if (!providedKey)
      return res.status(401).json({ message: "Missing SYNC-KEY header" });

    const storedHash = process.env.SYNC_KEY_HASH;
    if (!storedHash)
      return res
        .status(500)
        .json({ message: "Server SYNC KEY not configured" });

    const ok = await bcrypt.compare(providedKey, storedHash);
    if (!ok) return res.status(401).json({ message: "Unauthorized" });

    next();
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
}

const syncRouter = express.Router();

syncRouter.route("/mode").get(verifySyncKey, syncControllers.getSystemMode);
syncRouter.route("/online").post(verifySyncKey, syncControllers.goOnline);
syncRouter.route("/offline").post(verifySyncKey, syncControllers.goOffline);

// syncRouter
//   .route("/restore")
//   .post(
//     authControllers.protect,
//     authControllers.restrictTo("Admin3"),
//     syncControllers.restoreDatabase
//   );

module.exports = syncRouter;
