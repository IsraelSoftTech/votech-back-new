const express = require("express");

const classSubjectControllers = require("../controllers/classSubject.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const classSubjectRouter = express.Router();

classSubjectRouter.use(protect);
classSubjectRouter.use(restrictTo("Admin1", "Admin3"));
classSubjectRouter
  .route("/")
  .post(classSubjectControllers.createClassSubject)
  .get(classSubjectControllers.readAllClassSubjects);

classSubjectRouter
  .route("/save")
  .post(classSubjectControllers.saveClassSubjects);

classSubjectRouter
  .route("/:id")
  .get(classSubjectControllers.readOneClassSubject)
  .patch(classSubjectControllers.updateClassSubject)
  .delete(classSubjectControllers.deleteClassSubject);

module.exports = classSubjectRouter;
