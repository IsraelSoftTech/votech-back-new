const express = require("express");

const subjectControllers = require("../controllers/subject.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const subjectRouter = express.Router();

subjectRouter.use(protect);
// Editing a subject mirrors its coefficient/category onto the active
// year's subject_year_settings row, which is year-locked — the lock's
// grant check needs the request context to see who is asking.
subjectRouter.use(attachRequestContext);
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
