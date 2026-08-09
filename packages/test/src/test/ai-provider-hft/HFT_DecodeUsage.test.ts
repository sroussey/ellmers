/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createDecodeUsageReporter,
  createStreamingTextStreamer,
  createTextStreamer,
} from "@workglow/huggingface-transformers/ai-runtime";
import type { StreamPhase, StreamUsage } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

/** Drives the reporter with a clock the test advances by hand. */
function harness(intervalMs = 250) {
  const events: StreamUsage[] = [];
  let clock = 1_000;
  const reporter = createDecodeUsageReporter((event) => events.push(event), {
    intervalMs,
    now: () => clock,
  });
  return {
    events,
    reporter,
    /** Decode `count` token pieces, advancing the clock `ms` between each. */
    decode(count: number, ms: number) {
      for (let i = 0; i < count; i++) {
        clock += ms;
        reporter.onToken();
      }
    },
  };
}

describe("createDecodeUsageReporter", () => {
  it("reports the prompt size as input before a single token is decoded", () => {
    const h = harness();
    h.reporter.onPrompt(1240);

    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.type).toBe("usage");
    expect(h.events[0]!.usage.input).toBe(1240);
    // Nothing has been generated yet, and the provider bills no cache here.
    expect(h.events[0]!.usage.output).toBe(0);
    expect(h.events[0]!.usage.cached).toBeUndefined();
    expect(h.events[0]!.usage.cacheWrite).toBeUndefined();
  });

  it("emits cumulative snapshots, not per-token deltas", () => {
    const h = harness(0);
    h.reporter.onPrompt(100);
    h.decode(3, 10);

    const outputs = h.events.map((e) => e.usage.output);
    // 1, 2, 3 — a snapshot restates the call's running total, so a consumer
    // replaces rather than accumulates. Deltas would read 1, 1, 1.
    expect(outputs).toEqual([0, 1, 2, 3]);
    // The prompt size rides along on every snapshot; it does not vanish once
    // decoding starts.
    for (const event of h.events) expect(event.usage.input).toBe(100);
  });

  it("throttles to at most one snapshot per interval while decoding", () => {
    const h = harness(250);
    // 20 tokens 100ms apart = 2s of decode: far fewer than 20 snapshots.
    h.decode(20, 100);

    expect(h.events.length).toBeGreaterThan(0);
    expect(h.events.length).toBeLessThan(20);
  });

  it("flushes the final total even when the last tokens fall inside the interval", () => {
    const h = harness(250);
    h.decode(1, 0);
    h.decode(4, 10); // all inside one interval, so throttled away
    h.reporter.flush();

    // Without the flush the run would end reporting a stale count.
    expect(h.events.at(-1)!.usage.output).toBe(5);
  });

  it("does not emit an empty snapshot when nothing was decoded", () => {
    const h = harness();
    h.reporter.flush();
    expect(h.events).toEqual([]);
  });
});

class FakeTextStreamer {
  readonly puts: bigint[][][] = [];
  ended = false;

  constructor(
    _tokenizer: unknown,
    readonly options: {
      callback_function?: ((text: string) => void) | undefined;
    }
  ) {}

  put(value: bigint[][]): void {
    this.puts.push(value);
  }

  end(): void {
    this.ended = true;
  }
}

describe("HFT streaming streamer reports usage", () => {
  function build() {
    const events: Array<StreamPhase | StreamUsage> = [];
    const streamer = createStreamingTextStreamer(
      {},
      () => {},
      FakeTextStreamer as any,
      (event) => events.push(event)
    ) as unknown as FakeTextStreamer;
    return { events, streamer };
  }

  it("reports the prompt token count as input when the prompt arrives", () => {
    const { events, streamer } = build();
    streamer.put([[1n, 2n, 3n, 4n]]);

    const usage = events.filter((e): e is StreamUsage => e.type === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]!.usage.input).toBe(4);
  });

  it("still emits the Prefilling stage label alongside the usage snapshot", () => {
    const { events, streamer } = build();
    streamer.put([[1n, 2n]]);

    // The label says which stage the run is in; the snapshot says how much it
    // has spent. They answer different questions, so both are emitted.
    expect(events.filter((e) => e.type === "phase")).toEqual([
      { type: "phase", message: "Prefilling", progress: undefined },
    ]);
  });

  it("counts decoded pieces as output and flushes the total when generation ends", () => {
    const { events, streamer } = build();
    streamer.put([[1n, 2n]]);
    streamer.options.callback_function?.("a");
    streamer.options.callback_function?.("b");
    streamer.end();

    const last = events.filter((e): e is StreamUsage => e.type === "usage").at(-1)!;
    expect(last.usage.input).toBe(2);
    expect(last.usage.output).toBe(2);
    expect(streamer.ended).toBe(true);
  });
});

describe("HFT streamer prefill phase", () => {
  it("emits Prefilling exactly when the prompt reaches the streaming streamer", () => {
    const events: Array<StreamPhase | StreamUsage> = [];
    const streamer = createStreamingTextStreamer(
      {},
      () => {},
      FakeTextStreamer as any,
      (event) => events.push(event)
    ) as unknown as FakeTextStreamer;

    expect(events).toEqual([]);
    streamer.put([[1n, 2n]]);
    expect(events.filter((e) => e.type === "phase")).toEqual([
      { type: "phase", message: "Prefilling", progress: undefined },
    ]);

    streamer.put([[3n]]);
    expect(events.filter((e) => e.type === "phase")).toHaveLength(1);
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
