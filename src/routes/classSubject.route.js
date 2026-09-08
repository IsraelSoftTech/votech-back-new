const express = require("express");

const classSubjectControllers = require("../controllers/classSubject.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const classSubjectRouter = express.Router();

classSubjectRouter.use(protect);
// Without this, assertYearWritable's getRequestContext() call (used by
// saveClassSubjects/unassignSubject to enforce the archived-year grant
// check) always sees no request context and treats every caller as
// trusted — silently disabling the grant requirement for every real HTTP
// request, not just script/console callers. Same wiring mark.route.js
// already has.
classSubjectRouter.use(attachRequestContext);
// classSubjectRouter.use(restrictTo("Admin1", "Admin3"));
classSubjectRouter
  .route("/")
  .post(classSubjectControllers.createClassSubject)
  .get(classSubjectControllers.readAllClassSubjects);

classSubjectRouter
  .route("/save")
  .post(classSubjectControllers.saveClassSubjects);

classSubjectRouter
  .route("/unassign")
  .post(classSubjectControllers.unassignSubject);

classSubjectRouter
  .route("/:id")
  .get(classSubjectControllers.readOneClassSubject)
  .patch(classSubjectControllers.updateClassSubject)
  .delete(classSubjectControllers.deleteClassSubject);

module.exports = classSubjectRouter;
