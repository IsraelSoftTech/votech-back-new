const express = require("express");
const desktopAuthController = require("./controllers/auth.controller");
const { protect } = require("../controllers/auth.controller");
const syncController = require("./controllers/sync.controller");

const desktopRouter = express.Router();

desktopRouter.route("/auth/login").post(desktopAuthController.desktopLogin);
desktopRouter
  .route("/auth/refresh")
  .post(desktopAuthController.refreshDesktopSession);
desktopRouter.route("/sync/init/start").post(protect, syncController.initSync);

module.exports = desktopRouter;
