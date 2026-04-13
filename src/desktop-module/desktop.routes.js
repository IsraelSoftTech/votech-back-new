const express = require("express");
const desktopAuthController = require("./controllers/auth.controller");

const desktopRouter = express.Router();

desktopRouter.route("/auth/login").post(desktopAuthController.desktopLogin);

desktopRouter.route("/auth/refresh").post(desktopAuthController.desktopLogin);

module.exports = desktopRouter;
