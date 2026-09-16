const express = require("express");

const grantControllers = require("../controllers/academicYearGrant.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const academicYearGrantRouter = express.Router();

academicYearGrantRouter.use(protect);
academicYearGrantRouter.use(attachRequestContext);

academicYearGrantRouter.route("/mine").get(grantControllers.listMyLiveGrants);

academicYearGrantRouter.use(restrictTo("Admin1"));

academicYearGrantRouter
  .route("/")
  .get(grantControllers.listGrants)
  .post(grantControllers.createGrant);

academicYearGrantRouter.route("/:id/revoke").post(grantControllers.revokeGrant);

module.exports = academicYearGrantRouter;
