"use strict";

const jwt = require("jsonwebtoken");
const { pool } = require("../../../routes/utils");

module.exports = async (socket, next) => {
  try {
    const { sessionToken, deviceToken } = socket.handshake.auth;

    if (!sessionToken || !deviceToken) {
      return next(new Error("AUTH_MISSING"));
    }

    let decoded;
    try {
      decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error("AUTH_INVALID_TOKEN"));
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, status FROM user_devices
       WHERE device_token = $1 AND user_id = $2 AND status = 'bound'`,
      [deviceToken, decoded.id]
    );

    if (!rows.length) {
      return next(new Error("AUTH_DEVICE_MISMATCH"));
    }

    socket.userId = decoded.id;
    socket.role = decoded.role;
    socket.deviceToken = deviceToken;

    next();
  } catch (err) {
    console.error("[SyncMiddleware] Unexpected error:", err.message);
    next(new Error("AUTH_ERROR"));
  }
};
