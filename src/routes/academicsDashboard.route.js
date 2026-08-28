const express = require("express");

const { getDashboardSummary } = require("../controllers/academicsDashboard.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const academicsDashboardRouter = express.Router();

academicsDashboardRouter.use(protect);
academicsDashboardRouter.use(restrictTo("Admin3"));

academicsDashboardRouter.route("/summary").get(getDashboardSummary);

module.exports = academicsDashboardRouter;
