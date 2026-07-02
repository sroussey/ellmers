/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkerServerBase } from "@workglow/util/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PostedMessage {
  readonly type: string;
  readonly id?: string;
  readonly data?: unknown;
}

// Stubs `postMessage` so we can capture every reply the server tries to send.
// WorkerServerBase calls the global `postMessage` directly, so we replace it
// for the duration of each test and restore on teardown.
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

describe("WorkerServerBase abort-before-call race", () => {
  let stub: { captured: PostedMessage[]; restore(): void };

  beforeEach(() => {
    stub = installPostMessageStub();
  });

  afterEach(() => {
    stub.restore();
  });

  it("aborts a run-fn whose abort message arrived before the call", async () => {
    const server = new WorkerServerBase();
    const seenAborted: boolean[] = [];
    server.registerRunFunction("dummyRun", async (_input, _model, signal) => {
      // Record whether the signal is already aborted at the moment the
      // run-fn starts. The fix should make this `true`.
      seenAborted.push(signal.aborted);
    });

    // Abort first, then call. The handler must not lose the abort.
    await server.handleMessage({ type: "message", data: { type: "abort", id: "req-1" } });
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: "req-1",
        functionName: "dummyRun",
        run: true,
        args: [{}, undefined, undefined, undefined],
      },
    });

    expect(seenAborted).toEqual([true]);
    // The abort path should produce exactly one error reply (no result/complete).
    const errorReplies = stub.captured.filter((m) => m.id === "req-1" && m.type === "error");
    const completeReplies = stub.captured.filter((m) => m.id === "req-1" && m.type === "complete");
    expect(errorReplies.length).toBe(1);
    expect(completeReplies.length).toBe(0);
  });

  it("aborts a regular call whose abort arrived before the call", async () => {
    const server = new WorkerServerBase();
    const seenAborted: boolean[] = [];
    server.registerFunction("dummyCall", async (_input, _model, _progress, signal: AbortSignal) => {
      seenAborted.push(signal.aborted);
      return "result";
    });

    await server.handleMessage({ type: "message", data: { type: "abort", id: "req-2" } });
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: "req-2",
        functionName: "dummyCall",
        args: [{}, undefined],
      },
    });

    expect(seenAborted).toEqual([true]);
    const errorReplies = stub.captured.filter((m) => m.id === "req-2" && m.type === "error");
    expect(errorReplies.length).toBe(1);
  });

  it("does not post a second terminal reply when a non-cooperative call arrives after the dedupe window", async () => {
    vi.useFakeTimers();
    try {
      const server = new WorkerServerBase();
      // A non-cooperative run-fn: ignores the abort signal and returns normally.
      server.registerRunFunction("ignoresAbort", async () => {
        // intentionally does not check signal.aborted
      });

      // Abort arrives first; handleAbort posts the terminal error and schedules
      // cleanup of the completed id.
      await server.handleMessage({ type: "message", data: { type: "abort", id: "req-dup" } });

      // Advance past the OLD 5s completed-request cleanup window but stay within
      // the 30s pending-abort TTL — this is the window where a duplicate used
      // to slip through.
      await vi.advanceTimersByTimeAsync(6000);

      await server.handleMessage({
        type: "message",
        data: {
          type: "call",
          id: "req-dup",
          functionName: "ignoresAbort",
          run: true,
          args: [{}, undefined, undefined, undefined],
        },
      });

      const errorReplies = stub.captured.filter((m) => m.id === "req-dup" && m.type === "error");
      const completeReplies = stub.captured.filter(
        (m) => m.id === "req-dup" && m.type === "complete"
      );
      // Exactly one terminal reply (the abort error), never a second response.
      expect(errorReplies.length).toBe(1);
      expect(completeReplies.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a stream call whose abort arrived before the call", async () => {
    const server = new WorkerServerBase();
    const seenAborted: boolean[] = [];
    server.registerStreamFunction("dummyStream", async function* (_input, _model, signal) {
      seenAborted.push(signal.aborted);
      // Even though the signal is aborted, we still yield so the test can
      // verify that the abort was visible on entry. (The real wrapper would
      // return promptly when seeing signal.aborted; the worker layer's job
      // here is just to plumb the abort.)
      yield { type: "noop" };
    });

    await server.handleMessage({ type: "message", data: { type: "abort", id: "req-3" } });
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: "req-3",
        functionName: "dummyStream",
        stream: true,
        args: [{}, undefined],
      },
    });

    expect(seenAborted).toEqual([true]);
  });
});

describe("WorkerServerBase pendingAborts eviction policy", () => {
  let stub: { captured: PostedMessage[]; restore(): void };

  beforeEach(() => {
    stub = installPostMessageStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    stub.restore();
  });

  it("eviction-correctness: a legitimate pending abort survives a flood of other-id aborts", async () => {
    vi.useFakeTimers();
    const server = new WorkerServerBase();
    const seenAborted: boolean[] = [];
    server.registerRunFunction("dummyRun", async (_input, _model, signal) => {
      seenAborted.push(signal.aborted);
    });

    // Flood: 1500 distinct abort ids in a single synchronous tick.
    // Under the old FIFO policy this would have evicted the first 500 entries
    // (including `a-500`); under TTL-based eviction the marker for `a-500`
    // is still alive because no entry is older than the TTL.
    for (let i = 0; i < 1500; i++) {
      await server.handleMessage({
        type: "message",
        data: { type: "abort", id: `a-${i}` },
      });
    }

    // Now dispatch the matching call for an id that the old policy would
    // have evicted (`a-500`). The run-fn must observe an already-aborted
    // signal, proving the pending marker survived the flood.
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: "a-500",
        functionName: "dummyRun",
        run: true,
        args: [{}, undefined, undefined, undefined],
      },
    });

    expect(seenAborted).toEqual([true]);
  });

  it("TTL-expiry: pending abort marker is dropped after 30s, run-fn runs un-aborted", async () => {
    vi.useFakeTimers();
    const server = new WorkerServerBase();
    const seenAborted: boolean[] = [];
    server.registerRunFunction("dummyRun", async (_input, _model, signal) => {
      seenAborted.push(signal.aborted);
    });

    await server.handleMessage({
      type: "message",
      data: { type: "abort", id: "a-late" },
    });

    // Past the TTL window — the marker for `a-late` must have expired.
    vi.advanceTimersByTime(31_000);

    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: "a-late",
        functionName: "dummyRun",
        run: true,
        args: [{}, undefined, undefined, undefined],
      },
    });

    expect(seenAborted).toEqual([false]);
  });

  it("hard-cap safety: most-recent ids are preserved, oldest are evicted", async () => {
    vi.useFakeTimers();
    // Use an injected small cap so the test exercises the overflow eviction
    // path with ~100 entries instead of ~10,000. The full-size 10k path is
    // empirically too slow under vitest's fake-timer heap on CI runners
    // (every recordPendingAbort schedules a setTimeout — O(log n) per insert
    // — and the constant factors stack up). The eviction logic itself is
    // identical regardless of cap size.
    const HARD_CAP = 100;
    const server = new WorkerServerBase({ pendingAbortHardCap: HARD_CAP });

    // Step the clock by 1ms per insertion so the timestamps are strictly
    // monotonic and the oldest-first eviction has a well-defined order.
    // (All insertions stay inside the 30s TTL window.)
    for (let i = 0; i < HARD_CAP + 10; i++) {
      await server.handleMessage({
        type: "message",
        data: { type: "abort", id: `cap-${i}` },
      });
      vi.advanceTimersByTime(1);
    }

    // Reach into the private map to verify size invariants. The hard cap
    // eviction triggers when size > HARD_CAP and removes half — leaving
    // the set bounded at most at HARD_CAP after the trim.
    const pending = (server as unknown as { pendingAborts: Map<string, number> }).pendingAborts;
    expect(pending.size).toBeLessThanOrEqual(HARD_CAP);

    // Newest id was just inserted; it must survive.
    const newestId = `cap-${HARD_CAP + 9}`;
    expect(pending.has(newestId)).toBe(true);

    // Oldest id was evicted in the oldest-by-timestamp half.
    const oldestId = "cap-0";
    expect(pending.has(oldestId)).toBe(false);

    // Behavioural check via the public consume path: register a run-fn and
    // dispatch a call for the newest id. It should still be aborted.
    const seenAbortedNewest: boolean[] = [];
    server.registerRunFunction("dummyRunNewest", async (_input, _model, signal) => {
      seenAbortedNewest.push(signal.aborted);
    });
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: newestId,
        functionName: "dummyRunNewest",
        run: true,
        args: [{}, undefined, undefined, undefined],
      },
    });
    expect(seenAbortedNewest).toEqual([true]);

    // And a call for the oldest id should NOT be aborted (marker evicted).
    const seenAbortedOldest: boolean[] = [];
    server.registerRunFunction("dummyRunOldest", async (_input, _model, signal) => {
      seenAbortedOldest.push(signal.aborted);
    });
    await server.handleMessage({
      type: "message",
      data: {
        type: "call",
        id: oldestId,
        functionName: "dummyRunOldest",
        run: true,
        args: [{}, undefined, undefined, undefined],
      },
    });
    expect(seenAbortedOldest).toEqual([false]);
  });
});
