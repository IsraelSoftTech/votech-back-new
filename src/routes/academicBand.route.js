const express = require("express");

const academicBandControllers = require("../controllers/accademicBand.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const academicBandRouter = express.Router();

academicBandRouter.use(protect);
// AcademicBand is year-locked (index.model.js). Without this the lock's
// grant check sees no request context and waves every caller through as
// a trusted internal script.
academicBandRouter.use(attachRequestContext);

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
