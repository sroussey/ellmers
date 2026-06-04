/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker-thread fixture for JobQueueStreamWorker.integration.test.ts.
 *
 * Simulates a job executing inside a real worker thread that emits two ordered
 * `binary-delta` stream events. Each chunk is posted to the host with the
 * chunk's underlying `ArrayBuffer` in the transfer list — the exact mechanism
 * `WorkerServerBase.extractTransferables` (packages/util/src/worker/WorkerServerBase.ts)
 * applies automatically when a TypedArray crosses a worker boundary. The
 * transfer (rather than copy) detaches the worker's view of the buffer, which
 * the host asserts via the reported `byteLength` values in the terminal "done"
 * message (a stand-in for the job result the job would otherwise return).
 *
 * Plain `.mjs` (not `.ts`) so it can be launched directly by `worker_threads`
 * under the Node runtime vitest uses, without a TypeScript transform step.
 */

import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("jobQueueStreamWorker.fixture.mjs must run as a worker thread");
}

parentPort.on("message", () => {
  // Two ordered binary-delta chunks, then a finish — mirrors a job calling
  // ctx.emitStreamEvent?.(...) during execution.
  const first = new Uint8Array([1, 2]);
  const second = new Uint8Array([3]);

  parentPort.postMessage(
    { type: "binary-delta", port: "bytes", binaryDelta: first },
    [first.buffer]
  );
  parentPort.postMessage(
    { type: "binary-delta", port: "bytes", binaryDelta: second },
    [second.buffer]
  );
  parentPort.postMessage({ type: "finish", data: {} });

  // Report the worker-side byteLength of the retained chunk views AFTER they
  // were transferred. A genuine transfer detaches the underlying buffer, so
  // these are 0 under Node. (Stands in for the job result.)
  parentPort.postMessage({
    type: "done",
    firstByteLength: first.byteLength,
    secondByteLength: second.byteLength,
  });
});
