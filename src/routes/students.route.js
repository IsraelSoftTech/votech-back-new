const express = require("express");
const multer = require("multer");
const studentControllers = require("../controllers/student.controller");
const { generateClassIDCards, protect, restrictTo } = require("../controllers/auth.controller");

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

module.exports = studentRouter;
