// routes/marks.routes.js
const express = require("express");

const marksControllers = require("../controllers/mark.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");
const AppError = require("../utils/AppError");
const { StatusCodes } = require("http-status-codes");

const marksRouter = express.Router();

marksRouter.use(protect);
marksRouter.use(attachRequestContext);
// marksRouter.use(restrictTo("Admin1", "Admin3"));

const validateUser = (req, res, next) => {
  // Future improvement: validate that only the teacher assigned the subject can upload marks, just say the word, hmu on whatsapp.

  if (!req.user.id) {
    return next(
      new AppError(
        "User somehow not loged in, user must be logged in to upload marks",
        StatusCodes.INTERNAL_SERVER_ERROR
      )
    );
  }
  req.body.uploaded_by = req.user.id;
  // Request body received
  next();
};

marksRouter.use(validateUser);

marksRouter
  .route("/")
  .post(marksControllers.createMark)
  .get(marksControllers.readAllMarks);

marksRouter.route("/save").post(marksControllers.saveMarksBatch);
marksRouter.route("/terms").get(marksControllers.readAllTerms);
marksRouter.route("/sequences").get(marksControllers.readAllSequences);

// Single-student marks editor — deliberately Admin3-only, on top of
// whatever restriction the rest of this router has (currently none):
// editing one student's marks directly, outside the normal per-class
// entry flow, is powerful enough that it should never be reachable by a
// role broader than the one already trusted with the Students page.
marksRouter
  .route("/student/:id")
  .get(restrictTo("Admin3"), marksControllers.getStudentMarksForTerm);
marksRouter
  .route("/student/:id/save")
  .post(restrictTo("Admin3"), marksControllers.saveStudentMarks);

marksRouter
  .route("/:id")
  .get(marksControllers.readOneMark)
  .patch(marksControllers.updateMark)
  .delete(marksControllers.deleteMark);

module.exports = marksRouter;
