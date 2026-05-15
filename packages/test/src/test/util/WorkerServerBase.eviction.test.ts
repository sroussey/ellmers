/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkerServerBase } from "@workglow/util/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface PostedMessage {
  readonly type: string;
  readonly id?: string;
  readonly data?: unknown;
}

function installPostMessageStub(): {
  readonly captured: PostedMessage[];
  restore(): void;
} {
  const captured: PostedMessage[] = [];
  const original = (globalThis as { postMessage?: unknown }).postMessage;
  (globalThis as unknown as { postMessage: (m: PostedMessage) => void }).postMessage = (m) => {
    captured.push(m);
  };
  return {
    captured,
    restore() {
      if (typeof original === "function") {
        (globalThis as { postMessage?: unknown }).postMessage = original;
      } else {
        delete (globalThis as { postMessage?: unknown }).postMessage;
      }
    },
  };
}

/**
 * Verifies pending-abort hard-cap eviction and safety under concurrent
 * insert+evict workloads.
 *
 * The methods are private, but the eviction is observable through the
 * `pendingAborts` consume path: an abort with a never-arriving call
 * accumulates in the pending set; once the cap is exceeded the oldest
 * markers are dropped, so a later call for one of those evicted ids
 * should NOT be aborted on entry. Conversely, recently-recorded ids
 * survive the eviction.
 */
describe("WorkerServerBase pending-abort hard-cap eviction", () => {
  let stub: { captured: PostedMessage[]; restore(): void };

  beforeEach(() => {
    stub = installPostMessageStub();
  });

  afterEach(() => {
    stub.restore();
  });

  it("evicts oldest pending-abort markers when the hard cap is exceeded", async () => {
    const server = new WorkerServerBase({ pendingAbortHardCap: 1000 });

    // Issue 1500 aborts with no matching call. The cap is 1000; once
    // size > 1000, the implementation evicts roughly half of the oldest
    // entries by timestamp.
    for (let i = 0; i < 1500; i++) {
      await server.handleMessage({
        type: "message",
        data: { type: "abort", id: `evict-${i}` },
      });
    }

    // Stub postMessage now so we can observe whether an "evicted" id's call
    // is aborted on entry. If the marker survived eviction the run-fn would
    // see signal.aborted=true. If the marker was evicted, the run-fn sees
    // signal.aborted=false.
    const seen: Record<string, boolean> = {};
    server.registerRunFunction("probe", async (_input, _model, signal) => {
      // Capture aborted state at entry; the test inspects it after.
      // The id is conveyed via the per-call args so the run-fn is stateless.
      const tag = (_input as { tag: string }).tag;
      seen[tag] = signal.aborted;
    });

    // Probe an old id (should have been evicted) and a recent id (should
    // still be in the pending set).
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: `evict-100`,
        functionName: "probe",
        run: true,
        args: [{ tag: "old" }, undefined, undefined, undefined],
      },
    });
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: `evict-1400`,
        functionName: "probe",
        run: true,
        args: [{ tag: "recent" }, undefined, undefined, undefined],
      },
    });

    expect(seen.old).toBe(false); // evicted -> not aborted on entry
    expect(seen.recent).toBe(true); // survived -> aborted on entry
  });

  it("does not throw when concurrent insert + eviction happens", async () => {
    const server = new WorkerServerBase({ pendingAbortHardCap: 100 });

    // Drive enough aborts in parallel to trigger several eviction passes.
    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < 3000; i++) {
      tasks.push(
        server.handleMessage({
          type: "message",
          data: { type: "abort", id: `concurrent-${i}` },
        })
      );
    }
    // None of these should throw.
    await expect(Promise.all(tasks)).resolves.toBeDefined();
  });
});
