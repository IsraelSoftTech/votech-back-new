const express = require("express");

const classControllers = require("../controllers/class.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const classRouter = express.Router();

classRouter.use(protect);
// Without this, assertYearWritable's getRequestContext() call (used by
// setClassMasterForYear to enforce the archived-year grant check) always
// sees no request context and treats every caller as trusted — silently
// disabling the grant requirement for every real HTTP request, not just
// script/console callers. Same wiring mark.route.js already has.
classRouter.use(attachRequestContext);
// The list stays open to any authenticated role, dropdowns elsewhere
// depend on it. The per-class detail record (ClassDetailPage/ClassPage's
// edit modal, both Admin1/Admin3-only pages) is a different exposure,
// restricted here rather than on the whole router.
classRouter
  .route("/")
  .post(classControllers.createClass)
  .get(classControllers.readAllClasses);

classRouter
  .route("/:id")
  .get(restrictTo("Admin1", "Admin3"), classControllers.readOneClass)
  .patch(classControllers.updateClass)
  .delete(classControllers.deleteClass);

classRouter
  .route("/:id/class-master")
  .get(classControllers.getClassMasterHistory)
  .post(classControllers.setClassMasterForYear);

classRouter.route("/:id/stats").get(classControllers.getClassStats);

module.exports = classRouter;
