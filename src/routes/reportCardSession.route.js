const express = require("express");

const reportCardSessionControllers = require("../controllers/reportCardSession.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const reportCardSessionRouter = express.Router();

reportCardSessionRouter.use(protect);
reportCardSessionRouter.use(attachRequestContext);
reportCardSessionRouter.use(restrictTo("Admin3"));

reportCardSessionRouter
  .route("/")
  .get(reportCardSessionControllers.listSessions)
  .post(reportCardSessionControllers.startSession);

reportCardSessionRouter.route("/:id").get(reportCardSessionControllers.getSession);

module.exports = reportCardSessionRouter;
