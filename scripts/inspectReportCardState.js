"use strict";
require("dotenv").config();
const models = require("../src/models/index.model");

(async () => {
  try {
    const lock = await models.ReportCardRunLock.findAll({ raw: true });
    console.log("LOCK", JSON.stringify(lock));

    const sessions = await models.ReportCardSession.findAll({
      order: [["id", "DESC"]],
      limit: 10,
      raw: true,
    });
    console.log("SESSIONS", JSON.stringify(sessions, null, 2));

    const runs = await models.ReportCardRun.findAll({
      where: { status: ["pending", "running"] },
      raw: true,
    });
    console.log("STUCK_RUNS", JSON.stringify(runs, null, 2));

    const notifs = await models.AcademicJobNotification.findAll({
      order: [["id", "DESC"]],
      limit: 10,
      raw: true,
    });
    console.log("NOTIFICATIONS", JSON.stringify(notifs, null, 2));
  } catch (err) {
    console.error("FAILED", err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
