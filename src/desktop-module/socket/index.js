"use strict";

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let _io = null;
let _syncNamespace = null;
let _appNamespace = null;

function initSockets(httpServer) {
  _io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || origin === "file://") return callback(null, true);
        const allowed = [
          "http://localhost:5173",
          "http://localhost:3000",
          "https://votechs7academygroup.com",
        ];
        if (allowed.includes(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    },
  });

  _syncNamespace = _io.of("/sync");

  _syncNamespace.use(require("./sync.middleware"));

  _syncNamespace.on("connection", (socket) => {
    require("./sync.handler")(socket, _syncNamespace);
  });

  console.log("[Sockets] /sync namespace ready");

  // General-purpose web app namespace — used for things like promotion
  // run progress push. Kept separate from /sync so nothing here touches
  // desktop sync behavior.
  _appNamespace = _io.of("/app");

  _appNamespace.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers.authorization?.replace("Bearer ", "");
    if (!token) return next(new Error("Authentication error: no token"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error("Authentication error: invalid token"));
    }
  });

  _appNamespace.on("connection", (socket) => {
    socket.join(`user:${socket.userId}`);
    socket.on("disconnect", () => {});
  });

  console.log("[Sockets] /app namespace ready");

  return _io;
}

function getSyncNamespace() {
  if (!_syncNamespace) {
    throw new Error("[Sockets] Sync namespace not initialized yet.");
  }
  return _syncNamespace;
}

/**
 * Emit an event to one user's browser tab(s) on the /app namespace.
 * No-op if sockets haven't been initialized yet or the user isn't connected.
 */
function emitToUser(userId, event, data) {
  if (!_appNamespace) return;
  _appNamespace.to(`user:${userId}`).emit(event, data);
}

module.exports = { initSockets, getSyncNamespace, emitToUser };
