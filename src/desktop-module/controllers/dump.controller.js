"use strict";

const fs = require("fs");
const {
  JOB_STATUS,
  enqueue,
  getJob,
  consumeDownload,
  markDownloaded,
  getQueueStatus,
} = require("../utils/dumpQueue");

// ── POST /desktop/sync/dump/request ──────────────────────────────────────────
//
// Called by the desktop app on first launch (no initSyncComplete)
// or when the user explicitly requests a full resync.
//
// Request body: none required — user identity comes from req.user (JWT)
//
// Response:
//   202 { jobId, status: "generating" | "queued", queuePosition?, message }
//   200 { jobId, status: "ready", downloadUrl, token, generatedAt, totalRows }
//       — returned immediately if the user already has a ready job waiting

const requestDump = async (req, res) => {
  try {
    const { id: userId, role } = req.user;

    const job = enqueue(userId, role);

    // If the job is already ready (user had a waiting job from a previous
    // request) return the download info immediately so they don't have to poll
    if (job.status === JOB_STATUS.READY) {
      return res.status(200).json(buildReadyResponse(job, req));
    }

    if (job.status === JOB_STATUS.QUEUED) {
      return res.status(202).json({
        jobId: job.jobId,
        status: "queued",
        queuePosition: job.queuePosition,
        message:
          job.queuePosition === 1
            ? "Your sync is next in line. It will start automatically in a moment."
            : `${job.queuePosition - 1} sync${
                job.queuePosition - 1 === 1 ? "" : "s"
              } ahead of yours. Please wait — this starts automatically.`,
      });
    }

    // Status is "generating" — job started immediately
    return res.status(202).json({
      jobId: job.jobId,
      status: "generating",
      message:
        "Preparing your data. Poll /sync/dump/status/:jobId every 5 seconds.",
    });
  } catch (err) {
    console.error("[DumpController] requestDump error:", err.message);
    return res.status(500).json({ error: "Failed to start sync preparation" });
  }
};

// ── GET /desktop/sync/dump/status/:jobId ─────────────────────────────────────
//
// Polled by the desktop app every 5 seconds after requesting a dump.
// Returns the current job status.
//
// When status is "ready", response includes the download URL and one-time token.
// The desktop app should immediately begin downloading when it receives "ready".
//
// Responses:
//   200 { jobId, status: "generating", message }
//   200 { jobId, status: "queued", queuePosition, message }
//   200 { jobId, status: "ready", downloadUrl, token, generatedAt, totalRows }
//   200 { jobId, status: "failed", error }
//   404 { error: "Job not found" }
//   403 { error: "This job does not belong to your account" }

const getDumpStatus = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }

    const job = getJob(jobId);

    if (!job) {
      return res
        .status(404)
        .json({ error: "Job not found. Please request a new sync." });
    }

    if (job.userId !== userId) {
      return res
        .status(403)
        .json({ error: "This job does not belong to your account" });
    }

    switch (job.status) {
      case JOB_STATUS.GENERATING:
        return res.status(200).json({
          jobId: job.jobId,
          status: "generating",
          message: "Still preparing your data. Check back in a few seconds.",
          startedAt: job.startedAt,
        });

      case JOB_STATUS.QUEUED:
        return res.status(200).json({
          jobId: job.jobId,
          status: "queued",
          queuePosition: job.queuePosition,
          message:
            job.queuePosition === 1
              ? "Your sync is next. Starting any moment now."
              : `${job.queuePosition - 1} sync${
                  job.queuePosition - 1 === 1 ? "" : "s"
                } still ahead. Hang tight.`,
        });

      case JOB_STATUS.READY:
        return res.status(200).json(buildReadyResponse(job, req));

      case JOB_STATUS.FAILED:
        return res.status(200).json({
          jobId: job.jobId,
          status: "failed",
          error: job.error || "Sync preparation failed. Please try again.",
        });

      case JOB_STATUS.DOWNLOADED:
        return res.status(200).json({
          jobId: job.jobId,
          status: "downloaded",
          message:
            "This dump has already been downloaded. Request a new sync if needed.",
        });

      default:
        return res.status(200).json({ jobId: job.jobId, status: job.status });
    }
  } catch (err) {
    console.error("[DumpController] getDumpStatus error:", err.message);
    return res.status(500).json({ error: "Failed to retrieve sync status" });
  }
};

// ── GET /desktop/sync/dump/download/:jobId ────────────────────────────────────
//
// Streams the dump file directly to the client.
// Requires the one-time token as a query param: ?token=xxx
//
// No JWT auth required — the one-time token is the sole credential.
// It is cryptographically random, single-use, and tied to a specific job,
// making it strictly sufficient for this endpoint.
//
// Supports HTTP Range requests for resumable downloads.

const downloadDump = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    const result = consumeDownload(jobId, token);

    if (!result.valid) {
      return res.status(403).json({ error: result.reason });
    }

    const { job } = result;

    const filePath = job.filePath;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const rangeHeader = req.headers["range"];

    if (rangeHeader) {
      // ── Partial / resumable download ────────────────────────────────────────
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${job.fileName}"`,
        "X-Generated-At": job.generatedAt.toISOString(),
        "X-Job-Id": job.jobId,
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);

      stream.on("end", () => {
        // Only delete the file when the very last byte has been served
        if (end === fileSize - 1) {
          markDownloaded(jobId);
        }
      });

      stream.on("error", (err) => {
        console.error(
          `[DumpController] Range stream error for job ${jobId}:`,
          err.message
        );
      });

      return;
    }

    // ── Full file download ────────────────────────────────────────────────────
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${job.fileName}"`,
      "Accept-Ranges": "bytes",
      "X-Generated-At": job.generatedAt.toISOString(),
      "X-Total-Rows": job.totalRows,
      "X-Job-Id": job.jobId,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    stream.on("end", () => {
      markDownloaded(jobId);
    });

    stream.on("error", (err) => {
      console.error(
        `[DumpController] Full stream error for job ${jobId}:`,
        err.message
      );
    });
  } catch (err) {
    console.error("[DumpController] downloadDump error:", err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to stream dump file" });
    }
  }
};

// ── GET /desktop/sync/dump/queue-status ──────────────────────────────────────
// Health/debug endpoint. Protect with admin middleware in production.

const queueStatus = async (req, res) => {
  try {
    return res.status(200).json(getQueueStatus());
  } catch (err) {
    return res.status(500).json({ error: "Failed to get queue status" });
  }
};

// ── Helper ────────────────────────────────────────────────────────────────────

function buildReadyResponse(job, req) {
  const protocol = req.protocol;
  const host = req.get("host");
  const downloadUrl = `${protocol}://${host}/api/v1/desktop/sync/dump/download/${job.jobId}?token=${job.token}`;

  return {
    jobId: job.jobId,
    status: "ready",
    downloadUrl,
    token: job.token,
    generatedAt: job.generatedAt.toISOString(),
    totalRows: job.totalRows,
    message: "Your data is ready. Download starting now.",
  };
}

module.exports = {
  requestDump,
  getDumpStatus,
  downloadDump,
  queueStatus,
};
