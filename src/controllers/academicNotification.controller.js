"use strict";

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");

// A notification belongs to this request's user if it was addressed to
// them directly, or broadcast to their role, matching
// AcademicJobNotification's own user_id-or-role semantics (see the model).
function scopeToUser(req) {
  return {
    [Op.or]: [{ user_id: req.user.id }, { role: req.user.role }],
  };
}

const listNotifications = catchAsync(async (req, res) => {
  const notifications = await models.AcademicJobNotification.findAll({
    where: scopeToUser(req),
    order: [["id", "DESC"]],
    limit: 100,
  });
  appResponder(StatusCodes.OK, notifications, res);
});

const unreadCount = catchAsync(async (req, res) => {
  const count = await models.AcademicJobNotification.count({
    where: { ...scopeToUser(req), read_at: null },
  });
  appResponder(StatusCodes.OK, { count }, res);
});

const markRead = catchAsync(async (req, res, next) => {
  const notification = await models.AcademicJobNotification.findOne({
    where: { id: req.params.id, ...scopeToUser(req) },
  });
  if (!notification) {
    return appResponder(StatusCodes.NOT_FOUND, { message: "Notification not found" }, res);
  }
  if (!notification.read_at) {
    await notification.update({ read_at: new Date() });
  }
  appResponder(StatusCodes.OK, notification, res);
});

const markAllRead = catchAsync(async (req, res) => {
  await models.AcademicJobNotification.update(
    { read_at: new Date() },
    { where: { ...scopeToUser(req), read_at: null } }
  );
  appResponder(StatusCodes.OK, { status: "ok" }, res);
});

module.exports = { listNotifications, unreadCount, markRead, markAllRead };
