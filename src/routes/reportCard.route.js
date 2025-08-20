const express = require("express");

const reportCardControllers = require("../controllers/reportCard.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const reportCardRouter = express.Router();

reportCardRouter.use(protect);
reportCardRouter.use(restrictTo("Admin1", "Admin3"));

reportCardRouter.route("/bulk").get(reportCardControllers.bulkReportCards);
reportCardRouter.route("/single").get(reportCardControllers.singleReportCard);

module.exports = reportCardRouter;
