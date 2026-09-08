const express = require("express");
const { StatusCodes } = require("http-status-codes");

const academicYearControllers = require("../controllers/accademicYear.controller");

const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");
const AppError = require("../utils/AppError");

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
  .route("/switch")
  .post(restrictTo("Admin3"), academicYearControllers.switchAcademicYear);
// Admin3, not Admin1: carrying values into a new year is part of moving
// the school into that year, which is Admin3's job (same role that owns
// /switch above). It is offered as a step of the switch flow rather than
// as a standalone action.
accademicYearRouter
  .route("/carry-forward")
  .post(restrictTo("Admin3"), academicYearControllers.carryForwardAssignments);

// These three are reserved action paths, not numeric :id lookups. Without
// this guard, calling one of them with an unsupported verb (e.g. GET on
// /carry-forward) falls through to the "/:id" route below and crashes
// with a raw SequelizeDatabaseError trying to findByPk("carry-forward")
// instead of a clean 404.
accademicYearRouter
  .all(["/switch-checklist", "/switch", "/carry-forward"], (req, res, next) => {
    next(
      new AppError(
        `Cannot ${req.method} ${req.originalUrl}`,
        StatusCodes.NOT_FOUND
      )
    );
  })

  .route("/:id")

  .get(academicYearControllers.readOneAcademicYear)

  .patch(restrictTo("Admin3"), academicYearControllers.updateAcademicYear)

  .delete(restrictTo("Admin3"), academicYearControllers.deleteAcademicYear);

module.exports = accademicYearRouter;
