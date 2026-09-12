const express = require("express");

const academicYearControllers = require("../controllers/accademicYear.controller");
const { protect } = require("../controllers/auth.controller");

(async () => {
  try {
    await academicYearControllers.initAcademicYear();
  } catch (error) {
    console.error("Failed to initialize AcademicYear module", error);

    process.exit(1);
  }
})();

const accademicYearRouter = express.Router();

accademicYearRouter.use(protect);

accademicYearRouter.get(
  "/active",
  academicYearControllers.getActiveAcademicYear
);

accademicYearRouter.get(
  "/context",
  academicYearControllers.getAcademicYearContext
);

accademicYearRouter.get("/", academicYearControllers.readAllAcademicYears);

accademicYearRouter.get("/:id", academicYearControllers.readOneAcademicYear);

module.exports = accademicYearRouter;
