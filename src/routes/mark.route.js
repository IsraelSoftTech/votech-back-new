// routes/marks.routes.js
const express = require("express");

const marksControllers = require("../controllers/mark.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const AppError = require("../utils/AppError");
const { StatusCodes } = require("http-status-codes");

const marksRouter = express.Router();

marksRouter.use(protect);
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
  //   console.log(req.body);
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

marksRouter
  .route("/:id")
  .get(marksControllers.readOneMark)
  .patch(marksControllers.updateMark)
  .delete(marksControllers.deleteMark);

module.exports = marksRouter;
