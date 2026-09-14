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
  downloadMarksMatrixPdf,
} = require("../controllers/marksOverview.controller");

const reportCardRouter = express.Router();

reportCardRouter.use(protect);
// reportCardRouter.use(restrictTo("Admin1", "Admin3"));

reportCardRouter.route("/bulk").get(reportCardControllers.bulkReportCards);
reportCardRouter.route("/single").get(reportCardControllers.singleReportCard);
// Disabled 2026-09-12: this was the old puppeteer path, it launches a full
// Chromium (300MB+ on its own, more than the whole report-card budget on
// the 1GB VPS) and nothing in the frontend calls it any more, everything
// goes through /single-pdf-direct or report-card sessions (pdfmake +
// qpdf-wasm). Left here rather than deleted so the history of the
// endpoint is obvious if someone goes looking for it.
// reportCardRouter
//   .route("/bulk-pdfs")
//   .get(reportCardControllers.bulkReportCardsPdf);

reportCardRouter.route("/bulk-html").get(bulkPdfDirect);

reportCardRouter.route("/bulk-pdfs-direct").get(bulkPdfDirect);

reportCardRouter.route("/bulk-html-direct").get(bulkPdfDirect);
reportCardRouter.route("/single-pdf-direct").get(singlePdfDirect);
reportCardRouter.route("/master-sheet").get(classMasterSheet);
reportCardRouter.route("/master-sheet-data").get(classMasterSheetData);

reportCardRouter.route("/marks-overview/matrix").get(getMarksMatrix);
reportCardRouter.route("/marks-overview/matrix-pdf").get(downloadMarksMatrixPdf);
reportCardRouter.route("/marks-overview/coverage").get(getMarksCoverage);
reportCardRouter.route("/marks-overview/coverage-pdf").get(downloadCoveragePdf);

module.exports = reportCardRouter;
