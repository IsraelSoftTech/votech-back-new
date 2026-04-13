"use strict";

const { Server } = require("socket.io");

let _io = null;
let _syncNamespace = null;

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

  return _io;
}

function getSyncNamespace() {
  if (!_syncNamespace) {
    throw new Error("[Sockets] Sync namespace not initialized yet.");
  }
  return _syncNamespace;
}

module.exports = { initSockets, getSyncNamespace };
