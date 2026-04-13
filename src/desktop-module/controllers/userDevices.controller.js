"use strict";

const db = require("../models");
const { logUserActivity, getIpAddress, getUserAgent } = require("./utils");

const requestUnbind = async (req, res) => {
  try {
    const { deviceToken, userId, reason = null, requestedBy = null } = req.body;

    if (!deviceToken || !userId) {
      return res.status(400).json({
        error: "deviceToken and userId are required",
      });
    }

    const device = await db.UserDevice.findOne({
      where: { device_id: deviceToken },
    });

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (device.user_id !== Number(userId)) {
      return res.status(403).json({
        error: "Device does not belong to this user",
      });
    }

    if (device.device_status === "unbound") {
      return res.status(400).json({
        error: "Device is already unbound",
      });
    }

    const existingRequest = await db.DeviceUnbindRequest.findOne({
      where: {
        device_id: deviceToken,
        status: "pending",
      },
    });

    if (existingRequest) {
      return res.status(400).json({
        error: "An unbind request for this device is already pending",
        requestId: existingRequest.id,
      });
    }

    const unbindRequest = await db.DeviceUnbindRequest.create({
      user_id: Number(userId),
      device_id: deviceToken,
      requested_at: new Date(),
      requested_by: requestedBy ? Number(requestedBy) : null,
      reason,
      status: "pending",
    });

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    await logUserActivity(
      requestedBy ?? userId,
      "device_unbind_requested",
      `Device unbind requested for userId ${userId} — device ${deviceToken}`,
      "user_devices",
      device.id,
      null,
      ipAddress,
      userAgent
    );

    return res.status(201).json({
      message: "Unbind request submitted. Awaiting admin approval",
      requestId: unbindRequest.id,
    });
  } catch (error) {
    console.error("[requestUnbind] Error:", error);
    return res.status(500).json({ error: "Failed to submit unbind request" });
  }
};

const approveUnbind = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approvedBy } = req.body;

    if (!approvedBy) {
      return res.status(400).json({ error: "approvedBy is required" });
    }

    if (!requestId) {
      return res.status(400).json({ error: "requestId is required" });
    }

    const unbindRequest = await db.DeviceUnbindRequest.findOne({
      where: { id: Number(requestId) },
    });

    if (!unbindRequest) {
      return res.status(404).json({ error: "Unbind request not found" });
    }

    if (unbindRequest.status !== "pending") {
      return res.status(400).json({
        error: `Request is already ${unbindRequest.status}`,
        status: unbindRequest.status,
      });
    }

    const device = await db.UserDevice.findOne({
      where: { device_id: unbindRequest.device_id },
    });

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    await device.update({
      device_status: "unbound",
      unbound_at: new Date(),
      unbound_by: Number(approvedBy),
    });

    await unbindRequest.update({
      status: "approved",
      approved_by: Number(approvedBy),
      approved_at: new Date(),
    });

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    await logUserActivity(
      Number(approvedBy),
      "device_unbind_approved",
      `Device unbind approved for userId ${unbindRequest.user_id} — requestId ${requestId}`,
      "user_devices",
      device.id,
      null,
      ipAddress,
      userAgent
    );

    return res.status(200).json({
      message:
        "Device unbound successfully. The user can now register a new device on next login",
    });
  } catch (error) {
    console.error("[approveUnbind] Error:", error);
    return res.status(500).json({ error: "Failed to approve unbind request" });
  }
};

const rejectUnbind = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rejectedBy, reason = null } = req.body;

    if (!rejectedBy) {
      return res.status(400).json({ error: "rejectedBy is required" });
    }

    const unbindRequest = await db.DeviceUnbindRequest.findOne({
      where: { id: Number(requestId) },
    });

    if (!unbindRequest) {
      return res.status(404).json({ error: "Unbind request not found" });
    }

    if (unbindRequest.status !== "pending") {
      return res.status(400).json({
        error: `Request is already ${unbindRequest.status}`,
        status: unbindRequest.status,
      });
    }

    await unbindRequest.update({
      status: "rejected",
      rejected_by: Number(rejectedBy),
      rejected_at: new Date(),
      reason: reason ?? unbindRequest.reason,
    });

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    await logUserActivity(
      Number(rejectedBy),
      "device_unbind_rejected",
      `Device unbind rejected for userId ${unbindRequest.user_id} — requestId ${requestId}`,
      "user_devices",
      null,
      null,
      ipAddress,
      userAgent
    );

    return res.status(200).json({
      message: "Unbind request rejected. Device remains bound",
    });
  } catch (error) {
    console.error("[rejectUnbind] Error:", error);
    return res.status(500).json({ error: "Failed to reject unbind request" });
  }
};

const listDevices = async (req, res) => {
  try {
    const { status = null, userId = null, page = 1, limit = 50 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status) where.device_status = status;
    if (userId) where.user_id = Number(userId);

    const { count, rows } = await db.UserDevice.findAndCountAll({
      where,
      include: [
        {
          model: db.users,
          as: "user",
          attributes: ["id", "name", "username", "role", "email", "contact"],
        },
        {
          model: db.users,
          as: "unboundByUser",
          attributes: ["id", "name", "username"],
        },
      ],
      order: [["registered_at", "DESC"]],
      limit: Number(limit),
      offset,
    });

    return res.status(200).json({
      devices: rows,
      total: count,
      page: Number(page),
      pages: Math.ceil(count / Number(limit)),
    });
  } catch (error) {
    console.error("[listDevices] Error:", error);
    return res.status(500).json({ error: "Failed to fetch devices" });
  }
};

const listUnbindRequests = async (req, res) => {
  try {
    const { status = "pending", page = 1, limit = 50 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status !== "all") where.status = status;

    const { count, rows } = await db.DeviceUnbindRequest.findAndCountAll({
      where,
      include: [
        {
          model: db.users,
          as: "user",
          attributes: ["id", "name", "username", "role"],
        },
        {
          model: db.users,
          as: "requestedByUser",
          attributes: ["id", "name", "username"],
        },
        {
          model: db.users,
          as: "approvedByUser",
          attributes: ["id", "name", "username"],
        },
        {
          model: db.users,
          as: "rejectedByUser",
          attributes: ["id", "name", "username"],
        },
        {
          model: db.UserDevice,
          as: "device",
          attributes: [
            "device_id",
            "device_type",
            "device_os",
            "device_status",
            "registered_at",
            "last_seen_at",
          ],
        },
      ],
      order: [["requested_at", "DESC"]],
      limit: Number(limit),
      offset,
    });

    return res.status(200).json({
      requests: rows,
      total: count,
      page: Number(page),
      pages: Math.ceil(count / Number(limit)),
    });
  } catch (error) {
    console.error("[listUnbindRequests] Error:", error);
    return res.status(500).json({ error: "Failed to fetch unbind requests" });
  }
};

module.exports = {
  requestUnbind,
  approveUnbind,
  rejectUnbind,
  listDevices,
  listUnbindRequests,
};
