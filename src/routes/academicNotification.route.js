const express = require("express");

const notificationControllers = require("../controllers/academicNotification.controller");
const { protect } = require("../controllers/auth.controller");
const { attachRequestContext } = require("../utils/requestContext.util");

const academicNotificationRouter = express.Router();

academicNotificationRouter.use(protect);
academicNotificationRouter.use(attachRequestContext);

academicNotificationRouter.route("/").get(notificationControllers.listNotifications);
academicNotificationRouter.route("/unread-count").get(notificationControllers.unreadCount);
academicNotificationRouter.route("/mark-all-read").post(notificationControllers.markAllRead);
academicNotificationRouter.route("/:id/read").post(notificationControllers.markRead);

module.exports = academicNotificationRouter;
