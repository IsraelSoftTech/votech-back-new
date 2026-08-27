const express = require("express");

const { getSchoolSettings, updateSchoolSettings } = require("../controllers/schoolSettings.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");

const schoolSettingsRouter = express.Router();

schoolSettingsRouter.use(protect);

// Read is needed by anyone whose page prints a document (report cards,
// transcripts, etc.) — only writing the school's identity is Admin1-only.
schoolSettingsRouter.route("/").get(getSchoolSettings);
schoolSettingsRouter.route("/").patch(restrictTo("Admin1"), updateSchoolSettings);

module.exports = schoolSettingsRouter;
