"use strict";
// Makes sure the server runs with V8 heap limits sized for the 1GB VPS, no
// matter how it was launched (pm2, npm start, plain node).
//
// Why: measured on 2026-09-12 with real data, generating ONE class's report
// cards (95 students) peaked at 364MB RSS under default Node flags, while
// the live data at that peak was only ~75MB. The rest was garbage V8 had
// not bothered to collect yet, because its default limits assume gigabytes
// of RAM. With --max-old-space-size=256 --max-semi-space-size=4 the same
// run peaks at ~165MB and finishes slightly faster. Both flags matter: a
// small young generation alone just promotes garbage into old space, and an
// old-space cap alone still lets the young generation balloon.
//
// V8 reads these at process start, they cannot be applied from inside a
// running process (v8.setFlagsFromString is documented as having no effect
// on heap sizing after startup). So if the process finds itself without
// them, it re-launches index.js as a child with the flags and stays alive
// only to proxy signals and the exit code, which keeps pm2's supervision
// (and its IPC channel) intact. That wrapper costs one mostly-idle Node
// process, so the preferred setup is still to pass the flags at launch,
// which skips all of this:
//   pm2 start index.js --node-args="--max-old-space-size=256 --max-semi-space-size=4"
//   (or `node_args` in an ecosystem file, or plain `npm start`)

const path = require("path");

const REQUIRED_FLAGS = ["--max-old-space-size=256", "--max-semi-space-size=4"];

// Presence is checked by flag NAME, not value: an operator who deliberately
// sets a different size has made a choice this must not silently override.
function hasHeapFlags() {
  const given = [...process.execArgv, ...(process.env.NODE_OPTIONS || "").split(/\s+/)];
  return REQUIRED_FLAGS.every((flag) => {
    const name = flag.split("=")[0];
    return given.some((arg) => arg === name || arg.startsWith(`${name}=`));
  });
}

/**
 * Call first thing in index.js. Returns true when this process has become
 * a thin wrapper around a re-launched child and must NOT continue booting.
 */
function relaunchedWithHeapFlags() {
  if (hasHeapFlags()) return false;

  if (process.env.VOTECH_HEAP_FLAGS === "0") {
    console.warn("[heap] VOTECH_HEAP_FLAGS=0, running without V8 heap limits (not recommended on the VPS).");
    return false;
  }
  if (process.platform === "win32") {
    // Dev machines have the RAM; `npm start` / `npm run dev` carry the flags
    // for anyone who wants to reproduce VPS memory behavior locally.
    console.warn(`[heap] Running without ${REQUIRED_FLAGS.join(" ")} (dev only, not relaunching on Windows).`);
    return false;
  }

  const { spawn } = require("child_process");
  const entry = path.resolve(__dirname, "..", "..", "index.js");
  console.warn(
    `[heap] Launched without ${REQUIRED_FLAGS.join(" ")}, re-launching index.js with them. ` +
      "To avoid the extra wrapper process, start with: " +
      `pm2 start index.js --node-args="${REQUIRED_FLAGS.join(" ")}"`
  );
  const child = spawn(
    process.execPath,
    [...REQUIRED_FLAGS, ...process.execArgv, entry, ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env }
  );

  const forward = (signal) => () => {
    if (!child.killed) child.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, forward(signal));
  // pm2's graceful-stop handshake arrives as an IPC message, not a signal.
  process.on("message", (msg) => {
    if (msg === "shutdown") forward("SIGTERM")();
  });
  child.on("exit", (code, signal) => process.exit(code !== null ? code : signal ? 1 : 0));
  child.on("error", (err) => {
    // Spawning our own node binary failing is close to impossible, but if
    // it does, this process has already stopped booting, so the only honest
    // move is a loud exit (pm2 restarts it) rather than a half-alive server.
    console.error(
      `[heap] Failed to re-launch with heap flags: ${err.message}. ` +
        "Start with the flags explicitly, or set VOTECH_HEAP_FLAGS=0 to run without them."
    );
    process.exit(1);
  });
  return true;
}

module.exports = { relaunchedWithHeapFlags, hasHeapFlags, REQUIRED_FLAGS };
