const express = require("express");

const promotionControllers = require("../controllers/promotion.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const promotionRouter = express.Router();

promotionRouter.use(protect);
promotionRouter.use(attachRequestContext);
promotionRouter.use(restrictTo("Admin3"));

promotionRouter.route("/preview").post(promotionControllers.previewMove);

promotionRouter
  .route("/promoted-classes")
  .get(promotionControllers.getPromotedClasses);

promotionRouter
  .route("/runs")
  .get(promotionControllers.listRuns)
  .post(promotionControllers.startRun);

promotionRouter.route("/runs/:id").get(promotionControllers.getRun);

promotionRouter
  .route("/students/:studentId/history")
  .get(promotionControllers.getStudentPromotionHistory);

promotionRouter
  .route("/runs/:runId/moves/:moveId/students")
  .get(promotionControllers.getMoveStudents);

promotionRouter
  .route("/runs/:runId/moves/:moveId/students/:studentPromotionId/override")
  .post(promotionControllers.overrideStudentDecision);

promotionRouter
  .route("/runs/:runId/moves/:moveId/reverse")
  .post(promotionControllers.reverseMove);

module.exports = promotionRouter;
