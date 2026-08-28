"use strict";

const models = require("../models/index.model");

// Shared by every long-running academics background job (report card
// sessions, promotion runs, ...). The DB row IS the notification, not a
// WebSocket message: a socket push can be missed if the admin isn't
// connected at that exact instant, a persisted row can't be. Any socket
// emit a caller does alongside this is purely a "refetch now" nudge for an
// open tab, never a substitute for this row.
async function notify({ userId, role, type, title, message, deepLink }) {
  try {
    await models.AcademicJobNotification.create({
      user_id: userId || null,
      role: role || null,
      type,
      title,
      message: message || null,
      deep_link: deepLink || null,
    });
  } catch (err) {
    // A missed notification is recoverable (the run/session rows are still
    // the source of truth), never let this break the job itself.
    console.error("[AcademicJobNotification] Failed to write notification:", err.message);
  }
}

module.exports = { notify };
