"use strict";

module.exports = (socket, namespace) => {
  console.log(`[SyncHandler] Client connected: userId=${socket.userId}`);

  socket.on("disconnect", (reason) => {
    console.log(
      `[SyncHandler] Client disconnected: userId=${socket.userId} reason=${reason}`
    );
  });
};
