const express = require("express");
const multer = require("multer");
const studentControllers = require("../controllers/student.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const studentRouter = express.Router();

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

studentRouter.use(protect);

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

module.exports = studentRouter;
