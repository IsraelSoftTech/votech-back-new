"use strict";

const { Op } = require("sequelize");
const db = require("../../models/index.model");
const { getSyncNamespace } = require("../socket/index");

const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

async function cleanStaleSessions() {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const stale = await db.SyncSession.findAll({
      where: {
        status: "in_progress",
        [Op.or]: [
          { last_ack_at: { [Op.lt]: cutoff } },
          {
            last_ack_at: null,
            started_at: { [Op.lt]: cutoff },
          },
        ],
      },
    });

    if (!stale.length) return;

    const staleIds = stale.map((s) => s.id);

    await db.SyncSession.update(
      { status: "abandoned", updatedAt: new Date() },
      { where: { id: { [Op.in]: staleIds } } }
    );

    console.log(
      `[SyncCleanup] Abandoned ${staleIds.length} stale session(s):`,
      staleIds
    );

    // Promote queued clients now that slots are free
    await promoteQueuedSessions(staleIds.length);
  } catch (err) {
    console.error("[SyncCleanup] Failed:", err.message);
  }
}

async function promoteQueuedSessions(slotsFreed) {
  try {
    const SYNC_CONCURRENCY_CAP = parseInt(
      process.env.SYNC_CONCURRENCY_CAP || "5",
      10
    );

    const activeCount = await db.SyncSession.count({
      where: { status: "in_progress" },
    });

    const available = SYNC_CONCURRENCY_CAP - activeCount;
    if (available <= 0) return;

    // Get the next N queued sessions in order
    const toPromote = await db.SyncSession.findAll({
      where: { status: "queued" },
      order: [["queue_position", "ASC"]],
      limit: available,
    });

    if (!toPromote.length) return;

    for (const session of toPromote) {
      await session.update({
        status: "in_progress",
        queue_position: null,
        started_at: new Date(),
        updatedAt: new Date(),
      });

      // Notify the client via WebSocket that they've been promoted
      try {
        const syncNs = getSyncNamespace();
        syncNs.to(`session:${session.id}`).emit("sync:promoted", {
          sessionId: session.id,
          message: "Your sync is starting now.",
        });
      } catch (_) {
        // socket may not be connected yet — client will check status on reconnect
      }
    }

    console.log(`[SyncCleanup] Promoted ${toPromote.length} queued session(s)`);
  } catch (err) {
    console.error("[SyncCleanup] Promotion failed:", err.message);
  }
}

module.exports = { cleanStaleSessions, promoteQueuedSessions };
