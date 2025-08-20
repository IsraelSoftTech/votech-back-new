const express = require("express");

const studentControllers = require("../controllers/student.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const studentRouter = express.Router();

studentRouter.use(protect);
studentRouter.use(restrictTo("Admin1", "Admin3", "Teacher"));
studentRouter.route("/").get(studentControllers.readAllStudents);

studentRouter.route("/:id").get(studentControllers.readOneStudent);

module.exports = studentRouter;
