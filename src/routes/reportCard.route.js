const express = require("express");

const reportCardControllers = require("../controllers/reportCard.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const {
  bulkPdfDirect,
  singlePdfDirect,
} = require("../controllers/reportCardPdfGenerator");

const {
  classMasterSheet,
  classMasterSheetData,
} = require("../controllers/mastersheet.controller");

const {
  getMarksMatrix,
  getMarksCoverage,
  downloadCoveragePdf,
} = require("../controllers/marksOverview.controller");

const reportCardRouter = express.Router();

reportCardRouter.use(protect);
// reportCardRouter.use(restrictTo("Admin1", "Admin3"));

reportCardRouter.route("/bulk").get(reportCardControllers.bulkReportCards);
reportCardRouter.route("/single").get(reportCardControllers.singleReportCard);
reportCardRouter
  .route("/bulk-pdfs")
  .get(reportCardControllers.bulkReportCardsPdf);

reportCardRouter.route("/bulk-html").get(bulkPdfDirect);

reportCardRouter.route("/bulk-pdfs-direct").get(bulkPdfDirect);

reportCardRouter.route("/bulk-html-direct").get(bulkPdfDirect);
reportCardRouter.route("/single-pdf-direct").get(singlePdfDirect);
reportCardRouter.route("/master-sheet").get(classMasterSheet);
reportCardRouter.route("/master-sheet-data").get(classMasterSheetData);

reportCardRouter.route("/marks-overview/matrix").get(getMarksMatrix);
reportCardRouter.route("/marks-overview/coverage").get(getMarksCoverage);
reportCardRouter.route("/marks-overview/coverage-pdf").get(downloadCoveragePdf);

module.exports = reportCardRouter;
