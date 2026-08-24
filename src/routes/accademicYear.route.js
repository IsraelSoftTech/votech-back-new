const express = require("express");



const academicYearControllers = require("../controllers/accademicYear.controller");

const { protect, restrictTo } = require("../controllers/auth.controller");
const {
  academicYearSwitchRateLimit,
} = require("../middleware/academicYearSwitchRateLimit.middleware");



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



accademicYearRouter.get("/active", academicYearControllers.getActiveAcademicYear);

accademicYearRouter.get("/context", academicYearControllers.getAcademicYearContext);

accademicYearRouter.get(
  "/switch-logs",
  restrictTo("Admin1", "Admin3"),
  academicYearControllers.getAcademicYearSwitchLogs
);



accademicYearRouter.post(

  "/switch",

  restrictTo("Admin3"),

  academicYearSwitchRateLimit,

  academicYearControllers.switchAcademicYear

);



accademicYearRouter.post(

  "/rollover",

  restrictTo("Admin3"),

  academicYearSwitchRateLimit,

  academicYearControllers.rolloverAcademicYear

);



accademicYearRouter

  .route("/")

  .post(academicYearControllers.createAcademicYear)

  .get(academicYearControllers.readAllAcademicYears);



accademicYearRouter.post(

  "/:id/reactivate",

  restrictTo("Admin1"),

  academicYearControllers.reactivateAcademicYear

);



accademicYearRouter

  .route("/:id")

  .get(academicYearControllers.readOneAcademicYear)

  .patch(restrictTo("Admin3"), academicYearControllers.updateAcademicYear)

  .delete(restrictTo("Admin3"), academicYearControllers.deleteAcademicYear);



module.exports = accademicYearRouter;

