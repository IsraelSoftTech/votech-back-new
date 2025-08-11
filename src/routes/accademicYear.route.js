const express = require("express");

const academicYearControllers = require("../controllers/accademicYear.controller");
const auth = require("../utils/auth.util");
const { protect, restrictTo } = require("../controllers/auth.controller");

(async () => {
  try {
    await academicYearControllers.initAcademicYear();
    console.log("AcademicYear module ready, starting server...");
    // start your express server here
  } catch (error) {
    console.error("Failed to initialize AcademicYear module", error);
    process.exit(1);
  }
})();

const accademicYearRouter = express.Router();

accademicYearRouter.use(protect);
accademicYearRouter.use(restrictTo("Admin1"));
accademicYearRouter
  .route("/")
  .post(academicYearControllers.createAcademicYear)
  .get(academicYearControllers.readAllAcademicYears);

accademicYearRouter
  .route("/:id")
  .get(academicYearControllers.readOneAcademicYear)
  .patch(academicYearControllers.updateAcademicYear)
  .delete(academicYearControllers.deleteAcademicYear);

module.exports = accademicYearRouter;
