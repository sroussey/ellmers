/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createDecodeHeartbeat,
  createStreamingTextStreamer,
  createTextStreamer,
} from "@workglow/huggingface-transformers/ai-runtime";
import type { StreamPhase } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

/** Drives the heartbeat with a clock the test advances by hand. */
function harness(intervalMs = 250) {
  const events: StreamPhase[] = [];
  let clock = 1_000;
  const tick = createDecodeHeartbeat((event) => events.push(event), {
    intervalMs,
    now: () => clock,
  });
  return {
    events,
    /** Decode `count` token pieces, advancing the clock `ms` between each. */
    decode(count: number, ms: number) {
      for (let i = 0; i < count; i++) {
        clock += ms;
        tick();
      }
    },
  };
}

describe("createDecodeHeartbeat", () => {
  it("stays silent on the first token so it does not race the task's own Generating phase", () => {
    const h = harness();
    h.decode(1, 10_000);
    expect(h.events).toEqual([]);
  });

  it("emits at most once per interval and reports the running token count", () => {
    const h = harness(250);
    // 20 tokens at 100ms apart = 2s of decode, so ~8 heartbeats, not 20.
    h.decode(20, 100);

    expect(h.events.length).toBeGreaterThan(0);
    expect(h.events.length).toBeLessThan(20);
    for (const event of h.events) {
      expect(event.type).toBe("phase");
      expect(event.message).toMatch(/^Generating \d+ tok$/);
    }
  });

  it("reports a count, never a percentage — generation ends at an end token", () => {
    const h = harness(250);
    h.decode(10, 300);

    // `progress` left undefined: any fraction of `max_new_tokens` would stall
    // near an arbitrary value and then jump when the model stops early.
    for (const event of h.events) {
      expect(event.progress).toBeUndefined();
    }
    // The counts are strictly increasing and count every decoded piece.
    const counts = h.events.map((e) => Number(e.message.match(/(\d+) tok$/)![1]));
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(counts.length);
    expect(counts.at(-1)).toBeLessThanOrEqual(10);
  });

  it("does not fire while the model is slower than the interval, then resumes", () => {
    const h = harness(250);
    h.decode(1, 0); // anchor
    h.decode(1, 10); // too soon
    expect(h.events).toEqual([]);

    h.decode(1, 500); // interval elapsed
    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.message).toBe("Generating 3 tok");
  });

  it("honors a custom label", () => {
    const events: StreamPhase[] = [];
    let clock = 0;
    const tick = createDecodeHeartbeat((e) => events.push(e), {
      label: "Replying",
      intervalMs: 10,
      now: () => clock,
    });
    tick();
    clock += 100;
    tick();

    expect(events).toHaveLength(1);
    expect(events[0]!.message).toBe("Replying 2 tok");
  });
});

class FakeTextStreamer {
  readonly puts: bigint[][][] = [];

  constructor(
    _tokenizer: unknown,
    readonly options: {
      callback_function?: ((text: string) => void) | undefined;
    }
  ) {}

  put(value: bigint[][]): void {
    this.puts.push(value);
  }

  end(): void {}
}

describe("HFT streamer prefill phase", () => {
  it("emits Prefilling exactly when the prompt reaches the streaming streamer", () => {
    const events: StreamPhase[] = [];
    const streamer = createStreamingTextStreamer(
      {},
      () => {},
      FakeTextStreamer as any,
      (event) => events.push(event)
    ) as unknown as FakeTextStreamer;

    expect(events).toEqual([]);
    streamer.put([[1n, 2n]]);
    expect(events).toEqual([{ type: "phase", message: "Prefilling", progress: undefined }]);

    streamer.put([[3n]]);
    expect(events).toHaveLength(1);
    expect(streamer.puts).toEqual([[[1n, 2n]], [[3n]]]);
  });

  it("also emits Prefilling for the non-streaming progress streamer", () => {
    const updates: Array<{ progress: number | undefined; message: string | undefined }> = [];
    const streamer = createTextStreamer(
      {},
      (progress, message) => updates.push({ progress, message }),
      FakeTextStreamer as any
    ) as unknown as FakeTextStreamer;

    streamer.put([[1n, 2n]]);
    streamer.put([[3n]]);

    expect(updates).toEqual([{ progress: undefined, message: "Prefilling" }]);
  });
});
