const express = require("express");
const { StatusCodes } = require("http-status-codes");

const academicYearControllers = require("../controllers/accademicYear.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");
const AppError = require("../utils/AppError");

(async () => {
  try {
    await academicYearControllers.initAcademicYear();
    // AcademicYear module ready, starting server...
  } catch (error) {
    console.error("Failed to initialize AcademicYear module", error);
    process.exit(1);
  }
})();

const accademicYearRouter = express.Router();

accademicYearRouter.use(protect);
accademicYearRouter.use(attachRequestContext);

// Any authenticated role can read, readAllAcademicYears itself restricts
// non-Admin1/Admin3 roles to seeing only the active year.
accademicYearRouter.route("/").get(academicYearControllers.readAllAcademicYears);

// Fixed sub-paths must be registered before the "/:id" param route below,
// otherwise Express would match "switch-checklist" and "switch" as an :id.
accademicYearRouter
  .route("/switch-checklist")
  .get(
    restrictTo("Admin1", "Admin3"),
    academicYearControllers.getSwitchChecklist
  );
accademicYearRouter
  .route("/switch")
  .post(restrictTo("Admin3"), academicYearControllers.switchAcademicYear);
accademicYearRouter
  .route("/carry-forward")
  .post(restrictTo("Admin1"), academicYearControllers.carryForwardAssignments);

// These three are reserved action paths, not numeric :id lookups. Without
// this guard, calling one of them with an unsupported verb (e.g. GET on
// /carry-forward) falls through to the "/:id" route below and crashes
// with a raw SequelizeDatabaseError trying to findByPk("carry-forward")
// instead of a clean 404.
accademicYearRouter.all(
  ["/switch-checklist", "/switch", "/carry-forward"],
  (req, res, next) => {
    next(
      new AppError(
        `Cannot ${req.method} ${req.originalUrl}`,
        StatusCodes.NOT_FOUND
      )
    );
  }
);

accademicYearRouter.route("/:id").get(academicYearControllers.readOneAcademicYear);

accademicYearRouter.use(restrictTo("Admin1", "Admin3"));

accademicYearRouter.route("/").post(academicYearControllers.createAcademicYear);
accademicYearRouter
  .route("/:id")
  .patch(academicYearControllers.updateAcademicYear)
  .delete(academicYearControllers.deleteAcademicYear);

module.exports = accademicYearRouter;
