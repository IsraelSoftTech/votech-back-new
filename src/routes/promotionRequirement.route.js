const express = require("express");

const promotionRequirementControllers = require("../controllers/promotionRequirement.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const promotionRequirementRouter = express.Router();

promotionRequirementRouter.use(protect);
promotionRequirementRouter.use(attachRequestContext);

promotionRequirementRouter
  .route("/")
  .get(promotionRequirementControllers.readAllPromotionRequirements);

promotionRequirementRouter
  .route("/save")
  .post(
    restrictTo("Admin3"),
    promotionRequirementControllers.savePromotionRequirement
  );

promotionRequirementRouter
  .route("/:id")
  .get(promotionRequirementControllers.readOnePromotionRequirement)
  .delete(
    restrictTo("Admin3"),
    promotionRequirementControllers.deletePromotionRequirement
  );

module.exports = promotionRequirementRouter;
