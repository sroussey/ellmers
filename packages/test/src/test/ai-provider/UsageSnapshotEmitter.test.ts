/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createEstimatedOutputUsageReporter,
  createUsageSnapshotEmitter,
} from "@workglow/ai/provider-utils";
import { _testOnly as anthropicTestOnly } from "@workglow/anthropic/ai";
import type { StreamUsage, Usage } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

const { createAnthropicUsageCollector } = anthropicTestOnly;

const usage = (over: Partial<Usage>): Usage => ({
  input: undefined,
  output: undefined,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
  ...over,
});

describe("createUsageSnapshotEmitter", () => {
  it("emits nothing when the provider has reported nothing", () => {
    const events: StreamUsage[] = [];
    const snapshot = createUsageSnapshotEmitter((e) => events.push(e));

    snapshot(undefined);
    snapshot(undefined);

    expect(events).toEqual([]);
  });

  it("emits only when a counter actually moved", () => {
    // Gemini restates cumulative usage on every chunk; without this gate a long
    // generation emits one event per token.
    const events: StreamUsage[] = [];
    const snapshot = createUsageSnapshotEmitter((e) => events.push(e));

    snapshot(usage({ input: 100, output: 0 }));
    snapshot(usage({ input: 100, output: 0 }));
    snapshot(usage({ input: 100, output: 5 }));
    snapshot(usage({ input: 100, output: 5 }));

    expect(events.map((e) => e.usage.output)).toEqual([0, 5]);
  });

  it("emits cumulative snapshots, not deltas", () => {
    const events: StreamUsage[] = [];
    const snapshot = createUsageSnapshotEmitter((e) => events.push(e));

    snapshot(usage({ input: 100, output: 3 }));
    snapshot(usage({ input: 100, output: 9 }));

    // 9, not 6 — consumers replace rather than accumulate.
    expect(events[1].usage.output).toBe(9);
    expect(events[1].usage.input).toBe(100);
  });
});

describe("Anthropic reports input before the first text delta", () => {
  it("emits a snapshot carrying input tokens from message_start", () => {
    const events: StreamUsage[] = [];
    const snapshot = createUsageSnapshotEmitter((e) => events.push(e));
    const collector = createAnthropicUsageCollector();

    // message_start carries the prompt side before any content arrives — the
    // reason mid-stream reporting is worth having at all.
    collector.observe({ type: "message_start", message: { usage: { input_tokens: 1240 } } });
    snapshot(collector.result());

    expect(events).toHaveLength(1);
    expect(events[0].usage.input).toBe(1240);
    expect(events[0].usage.output).toBe(undefined);
  });
});

describe("createEstimatedOutputUsageReporter", () => {
  function harness(intervalMs = 250) {
    const events: StreamUsage[] = [];
    let clock = 1_000;
    const reporter = createEstimatedOutputUsageReporter((event) => events.push(event), {
      intervalMs,
      now: () => clock,
    });
    return {
      events,
      reporter,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  it("reports the prompt size as input before a single token is decoded", () => {
    const h = harness();
    h.reporter.onPrompt("abcd".repeat(310)); // 1240 chars → 310 tokens

    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.usage.input).toBe(310);
    expect(h.events[0]!.usage.output).toBe(0);
  });

  it("estimates output tokens from streamed text (ceil chars/4)", () => {
    const h = harness();
    h.reporter.onPrompt("prompt");
    h.advance(250);
    h.reporter.onText("abcd"); // 4 chars → 1 token
    expect(h.events.map((e) => e.usage)).toEqual([
      expect.objectContaining({ input: 2, output: 0 }),
      expect.objectContaining({ input: 2, output: 1 }),
    ]);
  });

  it("throttles mid-stream snapshots and flushes the final total", () => {
    const h = harness(250);
    h.reporter.onPrompt("hi"); // ↑1, ↓0
    h.advance(250);
    h.reporter.onText("abcd"); // t=1250 → emit ↓1
    h.advance(100);
    h.reporter.onText("efgh"); // within throttle — held
    expect(h.events.map((e) => e.usage.output)).toEqual([0, 1]);

    h.advance(200);
    h.reporter.onText("ijkl"); // → emit ceil(12/4)=3
    expect(h.events.map((e) => e.usage.output)).toEqual([0, 1, 3]);

    h.advance(50);
    h.reporter.onText("mn"); // 14 chars → 4, within throttle
    h.reporter.flush();
    expect(h.events.map((e) => e.usage.output)).toEqual([0, 1, 3, 4]);
    expect(h.events.every((e) => e.usage.input === 1)).toBe(true);
  });

  it("ignores empty deltas and does not flush when nothing arrived", () => {
    const h = harness();
    h.reporter.onText("");
    h.reporter.flush();
    expect(h.events).toEqual([]);
  });

  // Every counter this reporter emits is `ceil(chars / 4)`, not a provider
  // figure. Tagging them at the one place they are minted is what stops ~40
  // call sites across eight providers from having their guesses priced as
  // billed spend and written to `run_usage`.
  it("marks every snapshot as an estimate", () => {
    const h = harness();
    h.reporter.onPrompt("prompt");
    h.advance(250);
    h.reporter.onText("abcd");
    h.reporter.flush();

    expect(h.events.length).toBeGreaterThan(0);
    expect(h.events.every((e) => e.usage.estimated === true)).toBe(true);
  });
});
