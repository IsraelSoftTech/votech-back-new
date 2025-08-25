const express = require("express");

const contentControllers = require("../controllers/content.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const contentRouter = express.Router();

contentRouter.use(protect);
contentRouter.use(restrictTo("Admin1", "Admin3"));
contentRouter.route("/subjects").get(contentControllers.subjectsData);
contentRouter.route("/academic-years").get(contentControllers.academicYearData);
contentRouter.route("/classes").get(contentControllers.classesData);

module.exports = contentRouter;
