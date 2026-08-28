"use strict";
// Exercises the actual startSession controller function twice, back to
// back, to confirm the atomic lock genuinely rejects a second session
// while the first is still running, not just "looks right by construction."

const { startSession } = require("../src/controllers/reportCardSession.controller");
const models = require("../src/models/index.model");

function fakeReq(classIds) {
  return {
    body: { academic_year_id: 1, term: "term3", class_ids: classIds },
    user: { id: 2, role: "Admin3" },
  };
}

// catchAsync's wrapper doesn't return the underlying promise (it's
// designed for Express, which never awaits a handler either), so
// `await startSession(...)` alone doesn't actually wait for anything.
// Resolve on whichever of res.json/next fires first, that's the real
// "the synchronous/awaited portion of the handler, including the lock
// decision, is done" signal, same thing Express relies on.
function callAndWait(req) {
  return new Promise((resolve) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ statusCode: this.statusCode, data, err: null });
      },
    };
    const next = (err) => resolve({ statusCode: err?.statusCode, data: null, err });
    startSession(req, res, next);
  });
}

async function main() {
  // Reset any stale lock from a previous run so this test starts clean.
  await models.ReportCardRunLock.destroy({ where: {} });

  console.log("Starting session A (class 30, one class)...");
  const first = await callAndWait(fakeReq([30]));
  if (first.err) {
    console.error("Session A failed to start:", first.err.message);
    process.exit(1);
  }
  console.log(`[first] response ${first.statusCode}:`, JSON.stringify(first.data));

  console.log("Immediately starting session B while A is still running...");
  const second = await callAndWait(fakeReq([31]));
  console.log(`[second] response ${second.statusCode}:`, JSON.stringify(second.data));
  const secondErr = second.err;

  if (secondErr) {
    console.log(`PASS: second session was rejected: "${secondErr.message}" (status ${secondErr.statusCode})`);
  } else {
    console.log("FAIL: second session was NOT rejected, both are running concurrently.");
  }

  // Let session A's background executor finish before exiting, otherwise
  // we'd kill it mid-flight and see a false "still locked" state.
  console.log("Waiting for session A to finish in the background...");
  let waited = 0;
  while (waited < 30000) {
    const lock = await models.ReportCardRunLock.findByPk(1);
    if (!lock || !lock.current_session_id) break;
    await new Promise((r) => setTimeout(r, 1000));
    waited += 1000;
  }
  console.log("Done, lock state:", JSON.stringify(await models.ReportCardRunLock.findByPk(1, { raw: true })));
  process.exit(0);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
