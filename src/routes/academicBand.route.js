const express = require("express");

const academicBandControllers = require("../controllers/accademicBand.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const academicBandRouter = express.Router();

academicBandRouter.use(protect);

academicBandRouter
  .route("/")
  .post(restrictTo("Admin3"), academicBandControllers.createAcademicBand)
  .get(academicBandControllers.readAllAcademicBands);

academicBandRouter
  .route("/save")
  .post(restrictTo("Admin3"), academicBandControllers.saveAcademicBandsBatch);

academicBandRouter
  .route("/:id")
  .get(academicBandControllers.readOneAcademicBand)
  .patch(restrictTo("Admin3"), academicBandControllers.updateAcademicBand)
  .delete(restrictTo("Admin3"), academicBandControllers.deleteAcademicBand);

module.exports = academicBandRouter;
