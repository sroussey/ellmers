/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compound runners must forward the run's stream-pacing options
 * (`noAccumulation`, `streamHighWaterBytes`, `streamGateWatchdogMs`) into
 * their subgraph runs — a nested graph has its own edges and gates, and
 * dropping the options silently strips the caller's passthrough opt-in,
 * memory bound, and watchdog from everything inside the compound task.
 *
 * Each scenario patches `TaskGraph.prototype.run` to capture the config each
 * inner run receives.
 */

import type { StreamEvent, TaskGraphRunConfig, TaskInput } from "@workglow/task-graph";
import {
  FallbackTask,
  GraphAsTask,
  MapTask,
  Task,
  TaskGraph,
  WhileTask,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class AddOneTask extends Task<{ value: number }, { value: number }> {
  public static override type = "StreamOptForwarding_AddOne";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number", default: 0 } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: number }): Promise<{ value: number }> {
    return { value: (input.value ?? 0) + 1 };
  }
}

class MiniStreamer extends Task<Record<string, never>, { text: string }> {
  public static override type = "StreamOptForwarding_MiniStreamer";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<{ text: string }>> {
    yield { type: "text-delta", port: "text", textDelta: "hi" };
    yield { type: "finish", data: {} as { text: string } };
  }
}

const OPTS = {
  noAccumulation: true,
  streamHighWaterBytes: 4096,
  streamGateWatchdogMs: 1234,
} as const;

function hasForwardedOptions(config: TaskGraphRunConfig | undefined): boolean {
  return (
    config !== undefined &&
    config.noAccumulation === true &&
    config.streamHighWaterBytes === 4096 &&
    config.streamGateWatchdogMs === 1234
  );
}

describe("compound runners forward stream-pacing options into subgraph runs", () => {
  const captured: Array<TaskGraphRunConfig | undefined> = [];
  const origRun = TaskGraph.prototype.run;

  beforeEach(() => {
    captured.length = 0;
    (TaskGraph.prototype as any).run = function (input?: TaskInput, config?: TaskGraphRunConfig) {
      captured.push(config);
      return origRun.call(this, input ?? ({} as TaskInput), config ?? {});
    };
  });
  afterEach(() => {
    (TaskGraph.prototype as any).run = origRun;
  });

  it("GraphAsTask (non-streaming children path)", async () => {
    const sub = new TaskGraph();
    sub.addTask(new AddOneTask({ id: "inner", defaults: { value: 0 } }));
    const group = new GraphAsTask({ id: "group", subGraph: sub });

    await group.run({ value: 1 }, OPTS);
    expect(captured.some(hasForwardedOptions)).toBe(true);
  });

  it("GraphAsTask.executeStream (streaming group path)", async () => {
    const sub = new TaskGraph();
    sub.addTask(new MiniStreamer({ id: "inner-streamer" }));
    const group = new GraphAsTask({ id: "streaming-group", subGraph: sub });

    await group.run({}, OPTS);
    // The streaming path's inner run is the one that also disables leaf
    // accumulation.
    expect(captured.some((c) => hasForwardedOptions(c) && c?.accumulateLeafOutputs === false)).toBe(
      true
    );
  });

  it("WhileTask.execute", async () => {
    const sub = new TaskGraph();
    sub.addTask(new AddOneTask({ id: "w-inner", defaults: { value: 0 } }));
    const wt = new WhileTask({
      id: "while",
      maxIterations: 2,
      condition: () => false,
      subGraph: sub,
    });

    await wt.run({ value: 1 }, OPTS);
    expect(captured.some(hasForwardedOptions)).toBe(true);
  });

  it("MapTask iterations (cloned subgraph runs)", async () => {
    const mapTask = new MapTask({ id: "map", maxIterations: "unbounded" });
    const sub = new TaskGraph();
    sub.addTask(new AddOneTask({ id: "m-inner", defaults: { value: 0 } }));
    mapTask.subGraph = sub;

    await mapTask.run({ value: [1, 2] } as TaskInput, OPTS);
    const forwarded = captured.filter(hasForwardedOptions);
    // One captured inner run per iteration.
    expect(forwarded.length).toBeGreaterThanOrEqual(2);
  });

  it("FallbackTask data mode", async () => {
    const fb = new FallbackTask({
      id: "fallback",
      fallbackMode: "data",
      alternatives: [{ value: 5 }],
    });
    const sub = new TaskGraph();
    sub.addTask(new AddOneTask({ id: "f-inner", defaults: { value: 0 } }));
    fb.subGraph = sub;

    await fb.run({ value: 1 }, OPTS);
    expect(captured.some(hasForwardedOptions)).toBe(true);
  });
});
