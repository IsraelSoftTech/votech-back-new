"use strict";

const db = require("../../models/index.model");
const ScopeResolver = require("../utils/scopeResolver");

const SYNC_CONCURRENCY_CAP = parseInt(
  process.env.SYNC_CONCURRENCY_CAP || "5",
  10
);

const initSync = async (req, res) => {
  const { id: userId, role } = req.user;
  const deviceToken = req.headers["x-device-token"];

  if (!deviceToken) {
    return res.status(400).json({ error: "Missing x-device-token header." });
  }

  try {
    await db.SyncSession.update(
      { status: "abandoned", updatedAt: new Date() },
      {
        where: {
          device_token: deviceToken,
          status: ["pending", "queued", "in_progress"],
        },
      }
    );

    const activeCount = await db.SyncSession.count({
      where: { status: "in_progress" },
    });

    const resolver = new ScopeResolver();
    const manifest = await resolver.resolveManifest(userId, role);

    let status = "in_progress";
    let queuePosition = null;

    if (activeCount >= SYNC_CONCURRENCY_CAP) {
      const queuedCount = await db.SyncSession.count({
        where: { status: "queued" },
      });
      queuePosition = queuedCount + 1;
      status = "queued";
    }

    const scopeVersion = parseInt(process.env.SCOPE_VERSION || "1", 10);

    const session = await db.SyncSession.create({
      user_id: userId,
      device_token: deviceToken,
      status,
      queue_position: queuePosition,
      manifest,
      scope_version: scopeVersion,
      started_at: status === "in_progress" ? new Date() : null,
    });

    if (status === "queued") {
      return res.status(202).json({
        sessionId: session.id,
        status: "queued",
        queuePosition,
        message: `Sync queued — ${queuePosition - 1} user${
          queuePosition - 1 === 1 ? "" : "s"
        } ahead of you. Starting automatically when ready.`,
        manifest: session.manifest,
        scopeVersion: session.scope_version,
      });
    }

    return res.status(201).json({
      sessionId: session.id,
      status: "in_progress",
      queuePosition: null,
      message: "Sync session started. Connect via WebSocket to begin.",
      manifest: session.manifest,
      scopeVersion: session.scope_version,
    });
  } catch (err) {
    console.error("[SyncInit] Failed:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to initialize sync session." });
  }
};

const syncController = {
  initSync,
};

module.exports = syncController;
