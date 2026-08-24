const express = require("express");

const academicBandControllers = require("../controllers/accademicBand.controller");
const { protect } = require("../controllers/auth.controller");
const {
  injectActiveAcademicYearBody,
} = require("../middleware/injectActiveAcademicYear.middleware");

const academicBandRouter = express.Router();

academicBandRouter.use(protect);

academicBandRouter
  .route("/")
  .post(injectActiveAcademicYearBody, academicBandControllers.createAcademicBand)
  .get(academicBandControllers.readAllAcademicBands);

academicBandRouter
  .route("/save")
  .post(
    injectActiveAcademicYearBody,
    academicBandControllers.saveAcademicBandsBatch
  );

academicBandRouter
  .route("/:id")
  .get(academicBandControllers.readOneAcademicBand)
  .patch(academicBandControllers.updateAcademicBand)
  .delete(academicBandControllers.deleteAcademicBand);

module.exports = academicBandRouter;
