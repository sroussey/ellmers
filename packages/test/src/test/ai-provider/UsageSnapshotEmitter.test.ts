/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createUsageSnapshotEmitter } from "@workglow/ai/provider-utils";
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
