const express = require("express");

const academicBandControllers = require("../controllers/accademicBand.controller");
<<<<<<< HEAD
const { protect } = require("../controllers/auth.controller");
const {
  injectActiveAcademicYearBody,
} = require("../middleware/injectActiveAcademicYear.middleware");
=======
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");
>>>>>>> feature/student-promotion-and-academic-year-updates

const academicBandRouter = express.Router();

academicBandRouter.use(protect);
<<<<<<< HEAD

academicBandRouter
  .route("/")
  .post(injectActiveAcademicYearBody, academicBandControllers.createAcademicBand)
=======
// AcademicBand is year-locked (index.model.js). Without this the lock's
// grant check sees no request context and waves every caller through as
// a trusted internal script.
academicBandRouter.use(attachRequestContext);

academicBandRouter
  .route("/")
  .post(restrictTo("Admin3"), academicBandControllers.createAcademicBand)
>>>>>>> feature/student-promotion-and-academic-year-updates
  .get(academicBandControllers.readAllAcademicBands);

academicBandRouter
  .route("/save")
<<<<<<< HEAD
  .post(
    injectActiveAcademicYearBody,
    academicBandControllers.saveAcademicBandsBatch
  );
=======
  .post(restrictTo("Admin3"), academicBandControllers.saveAcademicBandsBatch);
>>>>>>> feature/student-promotion-and-academic-year-updates

academicBandRouter
  .route("/:id")
  .get(academicBandControllers.readOneAcademicBand)
  .patch(restrictTo("Admin3"), academicBandControllers.updateAcademicBand)
  .delete(restrictTo("Admin3"), academicBandControllers.deleteAcademicBand);

module.exports = academicBandRouter;
