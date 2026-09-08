const express = require("express");
const multer = require("multer");
const studentControllers = require("../controllers/student.controller");
<<<<<<< HEAD
const { protect, restrictTo } = require("../controllers/auth.controller");
=======
const { generateClassIDCards, protect, restrictTo } = require("../controllers/auth.controller");
const transcriptControllers = require("../controllers/transcript.controller");
const { singleStudentReportCardByYear } = require("../controllers/reportCardPdfGenerator");
const { attachRequestContext } = require("../utils/requestContext.util");
>>>>>>> feature/student-promotion-and-academic-year-updates

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

studentRouter
  .route("/:id")
  .get(studentControllers.readOneStudent)
  .patch(restrictTo("Admin3"), uploadPhoto.single("photo"), studentControllers.updateStudent)
  .delete(restrictTo("Admin3"), studentControllers.deleteStudent);

<<<<<<< HEAD
=======
// Generate ID cards for entire class - optimized for lightweight files
studentRouter.route("/class/:classId/id-cards").get(generateClassIDCards);
studentRouter.route("/class/:classId/list-pdf").get(studentControllers.classListPdf);

// Transcript: any student's full multi-year academic record. JSON preview
// first (which years, does each have marks) so the frontend can show
// something before committing to a PDF download.
studentRouter.route("/:id/transcript").get(transcriptControllers.getTranscript);
studentRouter.route("/:id/transcript/pdf").get(transcriptControllers.getTranscriptPdf);

// Report card for a chosen (academic_year_id, term) — Admin3-only, part
// of the same protected Student Detail page as the marks editor. Resolves
// the student's class for that specific year server-side, so the caller
// only ever needs to know the student and which year/term they want.
studentRouter
  .route("/:id/report-card-pdf")
  .get(restrictTo("Admin3"), singleStudentReportCardByYear);

>>>>>>> feature/student-promotion-and-academic-year-updates
module.exports = studentRouter;
