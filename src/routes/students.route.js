const express = require("express");
const multer = require("multer");
const studentControllers = require("../controllers/student.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const transcriptControllers = require("../controllers/transcript.controller");
const { singleStudentReportCardByYear } = require("../controllers/reportCardPdfGenerator");
const { attachRequestContext } = require("../utils/requestContext.util");

const studentRouter = express.Router();

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

studentRouter.use(protect);
// Student carries attachYearLockHooks (index.model.js) — without this,
// an edit to a student record from an archived year silently skips the
// grant check the same way class-master/class-subject writes did before
// their own route files got this same fix.
studentRouter.use(attachRequestContext);

studentRouter
  .route("/")
  .get(studentControllers.readAllStudents)
  .post(restrictTo("Admin3"), uploadPhoto.single("photo"), studentControllers.createStudent);

studentRouter
  .route("/orientation-pending")
  .get(restrictTo("Admin3"), studentControllers.listOrientationStudents);
studentRouter
  .route("/bulk-department-choice")
  .post(restrictTo("Admin3"), studentControllers.bulkSetDepartmentChoice);

studentRouter
  .route("/class/:classId/list-pdf")
  .get(studentControllers.classListPdf);

studentRouter.route("/:id/transcript").get(transcriptControllers.getTranscript);
studentRouter.route("/:id/transcript/pdf").get(transcriptControllers.getTranscriptPdf);

studentRouter
  .route("/:id/report-card-pdf")
  .get(restrictTo("Admin3"), singleStudentReportCardByYear);

studentRouter
  .route("/:id")
  .get(studentControllers.readOneStudent)
  .patch(restrictTo("Admin3"), uploadPhoto.single("photo"), studentControllers.updateStudent)
  .delete(restrictTo("Admin3"), studentControllers.deleteStudent);

module.exports = studentRouter;
