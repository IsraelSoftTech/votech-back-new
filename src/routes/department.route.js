const express = require("express");

const departmentControllers = require("../controllers/departments.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const departmentRouter = express.Router();

departmentRouter.use(protect);
// departmentRouter.use(restrictTo("Admin1", "Admin3"));
departmentRouter.route("/").get(departmentControllers.readAllDepartments);

departmentRouter.route("/:id").get(departmentControllers.readOneDepartment);

module.exports = departmentRouter;
