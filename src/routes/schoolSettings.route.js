const express = require("express");

const { getSchoolSettings, updateSchoolSettings } = require("../controllers/schoolSettings.controller");
const { protect, restrictTo } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const schoolSettingsRouter = express.Router();

schoolSettingsRouter.use(protect);
// Saving settings mirrors school name/principal onto the active year's
// school_setting_years row, which is year-locked.
schoolSettingsRouter.use(attachRequestContext);

// Every document generator (report cards, transcripts, etc.) reads
// settings through the exported getOrCreateSettings() function directly,
// in-process, not through this HTTP route, so restricting this route
// doesn't affect them. The School Settings page itself is the only
// frontend caller, and it's Admin1 (edit) / Admin3 (view) only.
schoolSettingsRouter.route("/").get(restrictTo("Admin1", "Admin3"), getSchoolSettings);
schoolSettingsRouter.route("/").patch(restrictTo("Admin1"), updateSchoolSettings);

module.exports = schoolSettingsRouter;
