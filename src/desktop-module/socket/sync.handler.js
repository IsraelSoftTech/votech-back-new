"use strict";

const { Op } = require("sequelize");
const db = require("../../models/index.model");
const ScopeResolver = require("../scope/scopeResolver");

const BATCH_SIZE = 500;

module.exports = (socket, namespace) => {
  console.log(`[SyncHandler] Client connected: userId=${socket.userId}`);

  socket.on("sync:join", async ({ sessionId }) => {
    try {
      const session = await db.SyncSession.findOne({
        where: {
          id: sessionId,
          user_id: socket.userId,
        },
      });

      if (!session) {
        return socket.emit("sync:error", { code: "SESSION_NOT_FOUND" });
      }

      if (session.status === "abandoned" || session.status === "failed") {
        return socket.emit("sync:error", {
          code: "SESSION_DEAD",
          message: "Session expired. Please call /sync/init/start again.",
        });
      }

      if (session.status === "queued") {
        return socket.emit("sync:queued", {
          sessionId: session.id,
          queuePosition: session.queue_position,
          message: `Sync queued — ${session.queue_position - 1} user${
            session.queue_position - 1 === 1 ? "" : "s"
          } ahead of you. Starting automatically when ready.`,
        });
      }

      socket.join(`session:${sessionId}`);
      socket.sessionId = sessionId;

      await streamSync(socket, session);
    } catch (err) {
      console.error("[SyncHandler] sync:join error:", err.message);
      socket.emit("sync:error", { code: "SERVER_ERROR", message: err.message });
    }
  });

  socket.on("sync:promoted", async () => {
    if (!socket.sessionId) return;
    try {
      const session = await db.SyncSession.findOne({
        where: { id: socket.sessionId },
      });
      if (session && session.status === "in_progress") {
        await streamSync(socket, session);
      }
    } catch (err) {
      console.error("[SyncHandler] sync:promoted error:", err.message);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(
      `[SyncHandler] Disconnected: userId=${socket.userId} reason=${reason}`
    );
  });
};

// ── Core streaming function ────────────────────────────────────────────────

async function streamSync(socket, session) {
  const resolver = new ScopeResolver();
  const { SCOPE_CONFIG, STRATEGY } = require("../scope/scopeConfig");

  const userId = session.user_id;
  const user = await db.users.findOne({
    where: { id: userId },
    attributes: ["role"],
  });

  if (!user) {
    socket.emit("sync:error", { code: "USER_NOT_FOUND" });
    return;
  }

  const role = user.role;
  const checkpoint = session.checkpoint || null;

  // Build ordered list of tables to stream (exclude NEVER)
  const tables = Object.keys(SCOPE_CONFIG).filter(
    (key) => SCOPE_CONFIG[key].strategy !== STRATEGY.NEVER
  );

  // Find resume point if checkpoint exists
  let startIndex = 0;
  let startOffset = 0;

  if (checkpoint) {
    const checkpointIndex = tables.indexOf(checkpoint.table);
    if (checkpointIndex !== -1) {
      startIndex = checkpointIndex;
      startOffset = checkpoint.offset || 0;
    }
  }

  try {
    for (let i = startIndex; i < tables.length; i++) {
      const tableKey = tables[i];
      const totalForTable = session.manifest?.[tableKey] ?? 0;

      // Resume offset only applies to the checkpoint table
      // all subsequent tables start from 0
      let offset = i === startIndex ? startOffset : 0;

      socket.emit("sync:table_start", {
        table: tableKey,
        total: totalForTable,
      });

      while (true) {
        const rows = await resolver.resolveSlice(
          userId,
          role,
          tableKey,
          offset,
          BATCH_SIZE
        );

        if (!rows || rows.length === 0) break;

        // Send batch and wait for client ack before continuing
        const acked = await sendBatchAndWaitForAck(socket, {
          table: tableKey,
          offset,
          rows,
          total: totalForTable,
        });

        if (!acked) {
          // Client disconnected or timed out — save checkpoint and exit
          await saveCheckpoint(session.id, tableKey, offset);
          return;
        }

        // Update last_ack_at and checkpoint after each confirmed batch
        await saveCheckpoint(session.id, tableKey, offset + rows.length);

        offset += rows.length;

        if (rows.length < BATCH_SIZE) break; // last batch for this table
      }

      socket.emit("sync:table_done", { table: tableKey });
    }

    // All tables done
    await db.SyncSession.update(
      {
        status: "complete",
        completed_at: new Date(),
        checkpoint: null,
        updatedAt: new Date(),
      },
      { where: { id: session.id } }
    );

    socket.emit("sync:complete", {
      sessionId: session.id,
      message: "Initial sync complete.",
    });

    // Promote next queued client
    const { promoteQueuedSessions } = require("./sync.cleanup");
    await promoteQueuedSessions(1);

    socket.disconnect(true);
  } catch (err) {
    console.error("[SyncHandler] Stream error:", err.message);

    await db.SyncSession.update(
      { status: "failed", updatedAt: new Date() },
      { where: { id: session.id } }
    );

    socket.emit("sync:error", {
      code: "STREAM_FAILED",
      message: "Sync failed. Reconnect to resume.",
    });

    socket.disconnect(true);
  }
}

function sendBatchAndWaitForAck(socket, payload) {
  return new Promise((resolve) => {
    const ackEvent = `sync:ack:${payload.table}:${payload.offset}`;

    const timeout = setTimeout(() => {
      socket.off(ackEvent, onAck);
      resolve(false);
    }, 30_000);

    function onAck() {
      clearTimeout(timeout);
      socket.off(ackEvent, onAck);
      resolve(true);
    }

    socket.once(ackEvent, onAck);
    socket.emit("sync:batch", payload);
  });
}

async function saveCheckpoint(sessionId, table, offset) {
  await db.SyncSession.update(
    {
      checkpoint: { table, offset },
      last_ack_at: new Date(),
      updatedAt: new Date(),
    },
    { where: { id: sessionId } }
  );
}
