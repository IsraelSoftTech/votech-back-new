const express = require("express");
const multer = require("multer");
const studentControllers = require("../controllers/student.controller");
const { generateClassIDCards, protect, restrictTo } = require("../controllers/auth.controller");
const transcriptControllers = require("../controllers/transcript.controller");
const { singleStudentReportCardByYear } = require("../controllers/reportCardPdfGenerator");

const studentRouter = express.Router();

// Memory storage, not disk — the controller streams the buffer out to
// FTP itself (see uploadStudentPhoto), matching every other upload path
// built this session. 5MB is generous for a passport-style photo.
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

studentRouter.use(protect);

studentRouter
  .route("/")
  .get(studentControllers.readAllStudents)
  .post(restrictTo("Admin3"), uploadPhoto.single("photo"), studentControllers.createStudent);

// Registered before "/:id" so "orientation-pending" and
// "bulk-department-choice" are never captured as an :id param.
studentRouter
  .route("/orientation-pending")
  .get(restrictTo("Admin3"), studentControllers.listOrientationStudents);
studentRouter
  .route("/bulk-department-choice")
  .post(restrictTo("Admin3"), studentControllers.bulkSetDepartmentChoice);

studentRouter
  .route("/:id")
  .get(studentControllers.readOneStudent)
  .patch(restrictTo("Admin3"), uploadPhoto.single("photo"), studentControllers.updateStudent)
  .delete(restrictTo("Admin3"), studentControllers.deleteStudent);

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

module.exports = studentRouter;
