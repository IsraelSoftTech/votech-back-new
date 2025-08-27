const express = require("express");

const departmentClassesControllers = require("../controllers/departmentClassescontroller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const departmentClassesRouter = express.Router();

departmentClassesRouter.use(protect);
// departmentClassesRouter.use(restrictTo("Admin1", "Admin3"));
departmentClassesRouter
  .route("/")
  .get(departmentClassesControllers.readAllDepartmentClassess);

departmentClassesRouter
  .route("/:id")
  .get(departmentClassesControllers.readOneDepartmentClasses);

module.exports = departmentClassesRouter;
