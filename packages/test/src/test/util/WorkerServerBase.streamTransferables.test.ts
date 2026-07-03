/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkerServerBase } from "@workglow/util/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface PostedMessage {
  readonly msg: { readonly type: string; readonly id?: string; readonly data?: any };
  readonly transfer: readonly unknown[];
}

// WorkerServerBase posts via the global `postMessage`. Capture BOTH the message
// and the transfer list (2nd positional arg) so we can assert binary buffers
// are transferred rather than structure-cloned.
function installPostMessageStub(): { captured: PostedMessage[]; restore(): void } {
  const captured: PostedMessage[] = [];
  const original = (globalThis as { postMessage?: unknown }).postMessage;
  (globalThis as unknown as { postMessage: (m: any, t?: readonly unknown[]) => void }).postMessage =
    (m, t) => {
      captured.push({ msg: m, transfer: t ?? [] });
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

describe("WorkerServerBase.postStreamChunk transferables", () => {
  let stub: { captured: PostedMessage[]; restore(): void };

  beforeEach(() => {
    stub = installPostMessageStub();
  });
  afterEach(() => {
    stub.restore();
  });

  it("transfers binary-delta buffers and clones text-delta", async () => {
    const server = new WorkerServerBase();
    server.registerRunFunction("emitStuff", async (_i, _m, _sig, emit) => {
      emit({ type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) });
      emit({ type: "text-delta", port: "text", textDelta: "hi" });
    });

    await server.handleMessage({
      type: "message",
      data: {
        id: "r1",
        type: "call",
        functionName: "emitStuff",
        args: [{}, undefined, undefined, undefined],
        run: true,
      },
    });

    const chunks = stub.captured.filter((c) => c.msg.type === "stream_chunk");
    expect(chunks.map((c) => c.msg.data.type)).toEqual(["binary-delta", "text-delta"]);

    // binary-delta: the backing ArrayBuffer rides the transfer list.
    const binTransfer = chunks[0].transfer;
    expect(binTransfer.length).toBe(1);
    expect(binTransfer[0]).toBeInstanceOf(ArrayBuffer);
    expect((binTransfer[0] as ArrayBuffer).byteLength).toBe(3);

    // text-delta: nothing to transfer — cloned exactly as before.
    expect(chunks[1].transfer).toEqual([]);

    // Terminal completion still posts.
    expect(stub.captured.some((c) => c.msg.type === "complete")).toBe(true);
  });
});
