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
