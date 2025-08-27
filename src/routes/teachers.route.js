const express = require("express");

const teacherControllers = require("../controllers/teachers.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const teacherRouter = express.Router();

teacherRouter.use(protect);
// teacherRouter.use(restrictTo("Admin1", "Admin3"));
teacherRouter.route("/").get(teacherControllers.readAllTeachers);

teacherRouter.route("/:id").get(teacherControllers.readOneTeacher);

module.exports = teacherRouter;
