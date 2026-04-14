const models = require("../../models/index.model");
const jwt = require("jsonwebtoken");
const {
  pool,
  authenticateToken,
  logUserActivity,
  createUserSession,
  endUserSession,
  getIpAddress,
  getUserAgent,
  JWT_SECRET,
} = require("../../../routes/utils");

module.exports = async (socket, next) => {
  try {
    const { sessionToken, deviceToken } = socket.handshake.auth;

    if (!sessionToken || !deviceToken) {
      return next(new Error("AUTH_MISSING"));
    }

    let decoded;
    try {
      decoded = jwt.verify(sessionToken, JWT_SECRET);
      console.log(decoded);
    } catch (err) {
      console.log(err);
      return next(new Error("AUTH_INVALID_TOKEN"));
    }

    const device = await models.UserDevice.findOne({
      where: {
        user_id: decoded.id,
        device_status: "bound",
      },
    });

    // console.log(device);

    if (!device) {
      return next(new Error("AUTH_DEVICE_MISMATCH"));
    }

    socket.userId = decoded.id;
    socket.role = decoded.role;
    socket.deviceToken = deviceToken;

    next();
  } catch (err) {
    // console.log(err);
    console.error("[SyncMiddleware] Unexpected error:", err.message);
    next(new Error("AUTH_ERROR"));
  }
};
