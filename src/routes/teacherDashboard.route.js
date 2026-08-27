const express = require("express");

const { getTeacherDashboard } = require("../controllers/teacherDashboard.controller");
const { protect } = require("../controllers/auth.controller");

const teacherDashboardRouter = express.Router();

teacherDashboardRouter.use(protect);

// Self-scoped by req.user.id — any authenticated user can hit this, it
// just returns nothing meaningful for someone who isn't a teacher.
teacherDashboardRouter.route("/summary").get(getTeacherDashboard);

module.exports = teacherDashboardRouter;
