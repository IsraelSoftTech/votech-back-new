"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateDump, deleteDumpFile, getDumpDir } = require("./dumpGenerator");

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 2;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour — jobs older than this are cleaned up
const DOWNLOAD_TTL_MS = 10 * 60 * 1000; // 10 minutes — ready jobs expire after this
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // run cleanup every 5 minutes

// ── Job status enum ───────────────────────────────────────────────────────────

const JOB_STATUS = {
  QUEUED: "queued",
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
  DOWNLOADED: "downloaded",
};

// ── In-memory job store ───────────────────────────────────────────────────────
// Map<jobId, Job>
// Job shape:
// {
//   jobId:        string,
//   userId:       number,
//   role:         string,
//   status:       JOB_STATUS,
//   createdAt:    Date,
//   startedAt:    Date | null,
//   completedAt:  Date | null,
//   filePath:     string | null,
//   fileName:     string | null,
//   generatedAt:  Date | null,   // timestamp embedded in dump meta line
//   totalRows:    number | null,
//   token:        string | null, // one-time download token
//   tokenUsed:    boolean,
//   error:        string | null,
//   queuePosition: number | null,
// }

const jobs = new Map();

// Active generation count — separate from jobs.size because
// jobs includes queued, ready, and failed entries too
let activeCount = 0;

// Pending queue — ordered list of jobIds waiting to run
const pending = [];

// ── Internal helpers ──────────────────────────────────────────────────────────

function makeJobId() {
  return crypto.randomBytes(16).toString("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getQueuePosition(jobId) {
  const idx = pending.indexOf(jobId);
  return idx === -1 ? null : idx + 1;
}

/**
 * Start the next job(s) from the pending queue if slots are available.
 * Called after every job completes or fails.
 */
function drainQueue() {
  while (activeCount < MAX_CONCURRENT && pending.length > 0) {
    const nextJobId = pending.shift();
    const job = jobs.get(nextJobId);

    if (!job) continue; // job was cancelled or cleaned up

    // Update queue positions for remaining pending jobs
    for (let i = 0; i < pending.length; i++) {
      const j = jobs.get(pending[i]);
      if (j) j.queuePosition = i + 1;
    }

    runJob(job);
  }
}

/**
 * Execute a generation job.
 * Updates job state throughout and calls drainQueue when done.
 */
async function runJob(job) {
  activeCount++;
  job.status = JOB_STATUS.GENERATING;
  job.startedAt = new Date();
  job.queuePosition = null;

  console.log(
    `[DumpQueue] Starting job ${job.jobId} for userId=${job.userId} role=${job.role}`
  );

  try {
    const { filePath, fileName, generatedAt, totalRows } = await generateDump(
      job.userId,
      job.role
    );

    job.status = JOB_STATUS.READY;
    job.completedAt = new Date();
    job.filePath = filePath;
    job.fileName = fileName;
    job.generatedAt = generatedAt;
    job.totalRows = totalRows;
    job.token = makeToken();
    job.tokenUsed = false;

    console.log(
      `[DumpQueue] Job ${job.jobId} ready. ` +
        `rows=${totalRows} token=${job.token.slice(0, 8)}...`
    );
  } catch (err) {
    job.status = JOB_STATUS.FAILED;
    job.completedAt = new Date();
    job.error = err.message;

    console.error(`[DumpQueue] Job ${job.jobId} failed:`, err.message);
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    drainQueue();
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Delete expired jobs and their dump files.
 * Runs on a regular interval.
 */
function cleanupStaleJobs() {
  const now = Date.now();

  for (const [jobId, job] of jobs.entries()) {
    const age = now - job.createdAt.getTime();

    // Remove any job older than JOB_TTL_MS
    if (age > JOB_TTL_MS) {
      if (job.filePath) deleteDumpFile(job.filePath);
      jobs.delete(jobId);
      console.log(
        `[DumpQueue] Cleaned up stale job ${jobId} (age=${Math.round(
          age / 60000
        )}min)`
      );
      continue;
    }

    // Remove READY jobs whose download window has expired
    if (
      job.status === JOB_STATUS.READY &&
      job.completedAt &&
      now - job.completedAt.getTime() > DOWNLOAD_TTL_MS
    ) {
      if (job.filePath) deleteDumpFile(job.filePath);
      jobs.delete(jobId);
      console.log(`[DumpQueue] Download window expired for job ${jobId}`);
      continue;
    }

    // Remove DOWNLOADED jobs — file already served and deleted
    if (job.status === JOB_STATUS.DOWNLOADED) {
      jobs.delete(jobId);
    }
  }

  // Also scan dump dir for orphaned files not tracked by any job
  try {
    const dumpDir = getDumpDir();
    const files = fs.readdirSync(dumpDir);
    const trackedFiles = new Set(
      [...jobs.values()].map((j) => j.fileName).filter(Boolean)
    );

    for (const file of files) {
      if (!trackedFiles.has(file)) {
        const filePath = path.join(dumpDir, file);
        const stat = fs.statSync(filePath);
        const fileAge = now - stat.mtimeMs;
        if (fileAge > JOB_TTL_MS) {
          fs.unlinkSync(filePath);
          console.log(`[DumpQueue] Deleted orphaned dump file: ${file}`);
        }
      }
    }
  } catch (err) {
    console.error("[DumpQueue] Cleanup scan error:", err.message);
  }
}

// Start cleanup interval
const cleanupTimer = setInterval(cleanupStaleJobs, CLEANUP_INTERVAL_MS);
// Allow process to exit even if interval is running
if (cleanupTimer.unref) cleanupTimer.unref();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * enqueue(userId, role)
 *
 * Enqueue a dump generation job for the given user.
 * If the user already has an active or ready job, returns that job's info
 * instead of creating a duplicate.
 *
 * Returns the job object.
 */
function enqueue(userId, role) {
  // Check if user already has a non-failed, non-expired job
  for (const job of jobs.values()) {
    if (job.userId === userId && job.role === role) {
      if (
        job.status === JOB_STATUS.QUEUED ||
        job.status === JOB_STATUS.GENERATING
      ) {
        console.log(
          `[DumpQueue] Returning existing active job ${job.jobId} for userId=${userId}`
        );
        return job;
      }
      if (job.status === JOB_STATUS.READY && !job.tokenUsed) {
        console.log(
          `[DumpQueue] Returning existing ready job ${job.jobId} for userId=${userId}`
        );
        return job;
      }
    }
  }

  const jobId = makeJobId();
  const job = {
    jobId,
    userId,
    role,
    status: JOB_STATUS.QUEUED,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    filePath: null,
    fileName: null,
    generatedAt: null,
    totalRows: null,
    token: null,
    tokenUsed: false,
    error: null,
    queuePosition: null,
  };

  jobs.set(jobId, job);

  if (activeCount < MAX_CONCURRENT) {
    // Start immediately
    runJob(job);
  } else {
    // Queue it
    pending.push(jobId);
    job.queuePosition = pending.length;
    console.log(
      `[DumpQueue] Job ${jobId} queued at position ${job.queuePosition} ` +
        `for userId=${userId}`
    );
  }

  return job;
}

/**
 * getJob(jobId)
 * Returns the current job state or null if not found.
 */
function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  // Attach live queue position for queued jobs
  if (job.status === JOB_STATUS.QUEUED) {
    job.queuePosition = getQueuePosition(jobId);
  }

  return job;
}

/**
 * consumeDownload(jobId, token)
 *
 * Validates the one-time download token for a ready job.
 * Returns { valid: true, job } or { valid: false, reason }
 *
 * Does NOT mark the token as used — that happens in markDownloaded()
 * after the file has been fully served to the client.
 */
function consumeDownload(jobId, token) {
  const job = jobs.get(jobId);

  if (!job) {
    return { valid: false, reason: "Job not found" };
  }

  if (job.status !== JOB_STATUS.READY) {
    return { valid: false, reason: `Job is not ready (status: ${job.status})` };
  }

  if (job.tokenUsed) {
    return { valid: false, reason: "Download token already used" };
  }

  if (job.token !== token) {
    return { valid: false, reason: "Invalid download token" };
  }

  if (!job.filePath || !fs.existsSync(job.filePath)) {
    return {
      valid: false,
      reason: "Dump file not found — please request a new sync",
    };
  }

  return { valid: true, job };
}

/**
 * markDownloaded(jobId)
 *
 * Called after the dump file has been fully streamed to the client.
 * Deletes the file and marks the job as downloaded.
 */
function markDownloaded(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.tokenUsed = true;
  job.status = JOB_STATUS.DOWNLOADED;

  if (job.filePath) {
    deleteDumpFile(job.filePath);
    job.filePath = null;
  }

  console.log(`[DumpQueue] Job ${jobId} downloaded and file deleted`);
}

/**
 * getQueueStatus()
 * Returns a summary of the current queue state.
 * Used for health/debug endpoints.
 */
function getQueueStatus() {
  const summary = {
    active: 0,
    queued: 0,
    ready: 0,
    failed: 0,
    total: jobs.size,
  };
  for (const job of jobs.values()) {
    if (job.status === JOB_STATUS.GENERATING) summary.active++;
    else if (job.status === JOB_STATUS.QUEUED) summary.queued++;
    else if (job.status === JOB_STATUS.READY) summary.ready++;
    else if (job.status === JOB_STATUS.FAILED) summary.failed++;
  }
  return summary;
}

module.exports = {
  JOB_STATUS,
  enqueue,
  getJob,
  consumeDownload,
  markDownloaded,
  getQueueStatus,
};
