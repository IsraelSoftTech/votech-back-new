const express = require("express");

const classControllers = require("../controllers/class.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const classRouter = express.Router();

classRouter.use(protect);
// classRouter.use(restrictTo("Admin1", "Admin3"));
classRouter
  .route("/")
  .post(classControllers.createClass)
  .get(classControllers.readAllClasses);

classRouter
  .route("/:id")
  .get(classControllers.readOneClass)
  .patch(classControllers.updateClass)
  .delete(classControllers.deleteClass);

module.exports = classRouter;
