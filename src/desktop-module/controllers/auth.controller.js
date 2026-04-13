"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../../models/index.model");
const {
  logUserActivity,
  createUserSession,
  getIpAddress,
  getUserAgent,
  JWT_SECRET,
} = require("../../../routes/utils");

const desktopLogin = async (req, res) => {
  try {
    const {
      username,
      password,
      deviceToken,
      deviceOs = null,
      deviceType = "desktop",
    } = req.body;

    if (!username || !password || !deviceToken) {
      return res.status(400).json({
        error: "username, password and deviceToken are required",
      });
    }
    const user = await db.users.findOne({
      where: { username },
    });

    // console.log(user);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.suspended) {
      return res.status(401).json({ error: "Account is suspended" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.forceOnlineLogin) {
      await db.users.update(
        { forceOnlineLogin: false },
        { where: { id: user.id } }
      );
    }

    const existingDevice = await db.UserDevice.findOne({
      where: { device_id: deviceToken },
    });

    if (existingDevice) {
      if (existingDevice.user_id !== user.id) {
        return res.status(403).json({
          error: "This device is registered to a different account",
        });
      }

      if (existingDevice.device_status === "unbound") {
        return res.status(403).json({
          error: "This device has been unbound. Contact your administrator",
        });
      }

      await existingDevice.update({ last_seen_at: new Date() });
    } else {
      const boundDevice = await db.UserDevice.findOne({
        where: {
          user_id: user.id,
          device_status: "bound",
        },
      });

      if (boundDevice) {
        return res.status(403).json({
          error:
            "This account is already registered to another device. " +
            "Request a device change through your administrator",
        });
      }

      await db.UserDevice.create({
        user_id: user.id,
        device_id: deviceToken,
        device_type: deviceType,
        device_os: deviceOs,
        device_status: "bound",
        registered_at: new Date(),
        last_seen_at: new Date(),
      });
    }

    const sessionToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        deviceToken,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    await logUserActivity(
      user.id,
      "desktop_login",
      "Desktop app login successful",
      null,
      null,
      null,
      ipAddress,
      userAgent
    );

    await createUserSession(user.id, ipAddress, userAgent);

    return res.status(200).json({
      sessionToken,
      userId: user.id,
      role: user.role,
      scopeVersion: user.scopeVersion ?? 0,
      initSyncComplete: false,
    });
  } catch (error) {
    console.error("[desktopLogin] Error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
};

const refreshDesktopSession = async (req, res) => {
  try {
    const { deviceToken, userId } = req.body;

    if (!deviceToken || !userId) {
      return res.status(400).json({
        error: "deviceToken and userId are required",
      });
    }

    const device = await db.UserDevice.findOne({
      where: { device_id: deviceToken },
    });

    if (!device) {
      return res.status(401).json({
        error: "Device not recognised",
        requiresLogin: true,
      });
    }

    if (device.user_id !== Number(userId)) {
      return res.status(403).json({
        error: "Device does not match this account",
        requiresLogin: true,
      });
    }

    if (device.device_status === "unbound") {
      return res.status(403).json({
        error: "This device has been unbound. Contact your administrator",
        requiresLogin: true,
      });
    }

    const user = await db.users.findOne({
      where: { id: device.user_id },
    });

    if (!user) {
      return res.status(401).json({
        error: "User not found",
        requiresLogin: true,
      });
    }

    if (user.suspended) {
      return res.status(401).json({
        error: "Account is suspended",
        requiresLogin: true,
      });
    }

    if (user.forceOnlineLogin) {
      return res.status(401).json({
        error: "Your password was recently changed. Please log in again",
        requiresLogin: true,
      });
    }

    const sessionToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        deviceToken,
      },
      JWT_SECRET
    );

    await device.update({ last_seen_at: new Date() });

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    await logUserActivity(
      user.id,
      "desktop_session_refresh",
      "Desktop session refreshed silently on reconnect",
      null,
      null,
      null,
      ipAddress,
      userAgent
    );

    return res.status(200).json({
      sessionToken,
      userId: user.id,
      role: user.role,
      scopeVersion: user.scopeVersion ?? 0,
    });
  } catch (error) {
    console.error("[refreshDesktopSession] Error:", error);
    return res.status(500).json({ error: "Session refresh failed" });
  }
};

const desktopAuthController = { desktopLogin, refreshDesktopSession };

module.exports = desktopAuthController;
