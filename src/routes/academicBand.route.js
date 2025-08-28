const express = require("express");

const academicBandControllers = require("../controllers/accademicBand.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const academicBandRouter = express.Router();

academicBandRouter.use(protect);
// academicBandRouter.use(restrictTo("Admin1", "Admin3"));

academicBandRouter
  .route("/")
  .post(academicBandControllers.createAcademicBand)
  .get(academicBandControllers.readAllAcademicBands);

academicBandRouter
  .route("/save")
  .post(academicBandControllers.saveAcademicBandsBatch);

academicBandRouter
  .route("/:id")
  .get(academicBandControllers.readOneAcademicBand)
  .patch(academicBandControllers.updateAcademicBand)
  .delete(academicBandControllers.deleteAcademicBand);

module.exports = academicBandRouter;
