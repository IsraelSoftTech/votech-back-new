const express = require("express");

const subjectControllers = require("../controllers/subject.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const subjectRouter = express.Router();

subjectRouter.use(protect);
// subjectRouter.use(restrictTo("Admin1", "Admin3"));
subjectRouter
  .route("/")
  .post(subjectControllers.createSubject)
  .get(subjectControllers.readAllSubjects);

subjectRouter.route("/filtered").get(subjectControllers.fileterdSubjects);

subjectRouter
  .route("/:id")
  .get(subjectControllers.readOneSubject)
  .patch(subjectControllers.updateSubject)
  .delete(subjectControllers.deleteSubject);

module.exports = subjectRouter;
