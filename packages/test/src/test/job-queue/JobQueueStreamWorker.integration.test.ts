/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Node primitive validation: structured-clone + transferable buffers across a
 * `worker_threads` boundary. Navigational marker for a future cross-thread
 * queue host — NOT a test of current `@workglow/job-queue` behavior.
 *
 * SCOPE — read before changing this test: today, `@workglow/job-queue`'s own
 * stream channel (`IJobExecuteContext.emitStreamEvent` → worker `job_stream`
 * event → `JobQueueServer.forwardToClients("handleJobStream", …)` →
 * `JobQueueClient` → `JobHandle.onStream`) is entirely SAME-PROCESS: the
 * `JobQueueWorker` runs in-process inside `JobQueueServer`, and
 * `forwardToClients` invokes attached-client methods directly (no postMessage,
 * no worker thread, no transferables). Cross-PROCESS coordination is handled
 * by the message-queue storage layer via `IMessageQueue.subscribeToChanges`
 * with serialized rows — also not a transferables path. There is no
 * `WorkerManager`-hosted queue transport anywhere in the package. The actual
 * same-process delivery path is proven by JobQueueStream.test.ts.
 *
 * This test therefore exercises the underlying Node primitive that a future
 * `WorkerServer`-hosted queue would have to rely on: binary chunks emitted
 * from a worker thread can be TRANSFERRED (not copied) to the host via
 * `postMessage`, which is what `WorkerServerBase.extractTransferables`
 * (packages/util/src/worker/WorkerServerBase.ts ~line 30) walks payloads to
 * arrange. `WorkerServerBase.postStreamChunk` now applies that walk too
 * (mirroring `postResult`), so incremental binary chunks are transferred, not
 * structure-cloned, across the worker boundary. This test validates the
 * underlying Node transfer semantics that path relies on. The worker emits two
 * `binary-delta`
 * events across the thread boundary (see jobQueueStreamWorker.fixture.mjs);
 * the host receives the full byte sequence in order, and the worker's
 * transferred views detach (`byteLength` becomes 0). Run under Node (vitest's
 * default pool); bun's worker_threads does not detach transferred buffers,
 * which is why this is an `.integration` test executed under the Node ABI per
 * libs/.claude/CLAUDE.md.
 */
describe("worker_threads transfer mechanism — payload validation for a future cross-thread queue host (not current job-queue code)", () => {
  let worker: Worker | undefined;

  afterEach(async () => {
    if (worker) {
      await worker.terminate();
      worker = undefined;
    }
  });

  it("host receives the full byte sequence in order; worker buffers detach", async () => {
    const fixtureUrl = new URL("./jobQueueStreamWorker.fixture.mjs", import.meta.url);
    worker = new Worker(fixtureUrl);

    const received: Array<{ type: string; port?: string; binaryDelta?: Uint8Array }> = [];

    const done = await new Promise<{ firstByteLength: number; secondByteLength: number }>(
      (resolve, reject) => {
        worker!.on("error", reject);
        worker!.on("message", (msg: Record<string, unknown>) => {
          // The host plays the role of `JobHandle.onStream` listener: collect
          // every stream event the worker emits across the thread boundary.
          if (msg.type === "binary-delta" || msg.type === "finish") {
            received.push(msg as { type: string; port?: string; binaryDelta?: Uint8Array });
          } else if (msg.type === "done") {
            resolve(msg as { firstByteLength: number; secondByteLength: number });
          }
        });
        worker!.postMessage("start");
      }
    );

    // Events arrived in emission order across the thread boundary.
    expect(received.map((e) => e.type)).toEqual(["binary-delta", "binary-delta", "finish"]);

    // Host received the full byte sequence in order across the two events.
    const hostBytes = received
      .filter((e) => e.type === "binary-delta")
      .flatMap((e) => Array.from(e.binaryDelta as Uint8Array));
    expect(hostBytes).toEqual([1, 2, 3]);

    // Detachment: the worker transferred (did not copy) each chunk buffer, so
    // its own views are now detached (byteLength === 0). This is the
    // `WorkerServerBase.extractTransferables` behavior. Asserted under Node,
    // which detaches transferred buffers per the structured-clone transfer
    // semantics the design depends on.
    expect(done.firstByteLength).toBe(0);
    expect(done.secondByteLength).toBe(0);
  });
});
