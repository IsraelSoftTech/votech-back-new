"use strict";
// Runs the muhammara whole-school merge on a worker thread, so the main
// thread's event loop stays free to sample RSS/CPU while this call blocks.
// See measureWholeSchoolMuhammaraMerge.js: the first run of this benchmark
// showed 0 for every phase-B sample because appendPDFPagesFromPDF is a
// synchronous native call with no async variant, it froze the process's
// only thread for the full merge duration and starved the sampling timers
// running on that same thread. Moving the merge itself to a worker doesn't
// change that blocking behavior (the worker's own thread is just as frozen
// during the call), it just gives the main thread a thread to sample FROM.
const { workerData, parentPort } = require("worker_threads");
const muhammara = require("muhammara");

const { classPdfPaths, finalPath } = workerData;

const writer = muhammara.createWriter(finalPath);
for (const p of classPdfPaths) {
  writer.appendPDFPagesFromPDF(p);
}
writer.end();

parentPort.postMessage({ done: true });
