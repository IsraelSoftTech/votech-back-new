const express = require("express");

const teacherControllers = require("../controllers/teachers.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const teacherRouter = express.Router();

teacherRouter.use(protect);
// The list stays open to any authenticated role, dropdowns elsewhere
// (class/subject teacher-assignment pickers) depend on it. The per-teacher
// detail record (used only by the academics module's Teacher Detail page,
// itself Admin3-only) is a different exposure, restricted here.
teacherRouter.route("/").get(teacherControllers.readAllTeachers);

teacherRouter.route("/:id").get(restrictTo("Admin1", "Admin3"), teacherControllers.readOneTeacher);

module.exports = teacherRouter;
