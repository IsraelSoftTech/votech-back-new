"use strict";

const express = require("express");
const desktopAuthController = require("./controllers/auth.controller");
const syncController = require("./controllers/sync.controller");
const dumpController = require("./controllers/dump.controller");
const { deltaSync } = require("./controllers/delta.controller");
const userDevicesController = require("./controllers/userDevices.controller");
const { protect } = require("../controllers/auth.controller");

const desktopRouter = express.Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

desktopRouter.post("/auth/login", desktopAuthController.desktopLogin);
desktopRouter.post(
  "/auth/refresh",
  desktopAuthController.refreshDesktopSession
);

// ── Legacy WebSocket-based initial sync (kept for backwards compatibility) ────
// This endpoint creates a SyncSession that the WebSocket handler joins.
// New clients should use /sync/dump/request instead.
// Remove this once all clients are on the dump-based flow.

desktopRouter.post("/sync/init/start", protect, syncController.initSync);

// ── Dump-based initial sync ───────────────────────────────────────────────────
//
// Flow:
//   1. POST /sync/dump/request      → enqueue generation job, get jobId
//   2. GET  /sync/dump/status/:jobId → poll until status = "ready"
//   3. GET  /sync/dump/download/:jobId?token=xxx → stream the file
//   4. POST /sync/delta             → fill gap from generatedAt to now

desktopRouter.post("/sync/dump/request", protect, dumpController.requestDump);

desktopRouter.get(
  "/sync/dump/status/:jobId",
  protect,
  dumpController.getDumpStatus
);

desktopRouter.get("/sync/dump/download/:jobId", dumpController.downloadDump);

// ── Delta sync (two-way LWW) ──────────────────────────────────────────────────
//
// Called:
//   - Immediately after dump import completes (gap fill)
//   - On every reconnect
//   - Every 5 minutes while the app is open and connected

desktopRouter.post("/sync/delta", protect, deltaSync);

// ── Device management ─────────────────────────────────────────────────────────

desktopRouter.post(
  "/devices/unbind/request",
  userDevicesController.requestUnbind
);
desktopRouter.post(
  "/devices/unbind/:requestId/approve",
  protect,
  userDevicesController.approveUnbind
);
desktopRouter.post(
  "/devices/unbind/:requestId/reject",
  protect,
  userDevicesController.rejectUnbind
);
desktopRouter.get("/devices", protect, userDevicesController.listDevices);
desktopRouter.get(
  "/devices/unbind-requests",
  protect,
  userDevicesController.listUnbindRequests
);

// ── Health / debug ────────────────────────────────────────────────────────────
// Protect this in production — exposes internal queue state

desktopRouter.get(
  "/sync/dump/queue-status",
  protect,
  dumpController.queueStatus
);

module.exports = desktopRouter;
