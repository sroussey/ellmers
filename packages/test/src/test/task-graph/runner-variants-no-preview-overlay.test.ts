/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import {
  FallbackTask,
  GraphAsTask,
  MapTask,
  Task,
  TaskGraph,
  WhileTask,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Spy task fixtures
// ============================================================================

/**
 * Per-iteration child for MapTask. Receives a single iteration value from an
 * array-typed input port on the parent.
 *
 * Uses STATIC class-level spies because IteratorTaskRunner clones the subgraph
 * (and re-instantiates each child task) per iteration, so instance-level spies
 * on the original child reference would never observe calls.
 */
class IterChildSpyTask extends Task<{ value: number }, { out: number }, TaskConfig> {
  public static executeSpy = vi.fn(async (input: { value: number }, _ctx: IExecuteContext) => ({
    out: input.value * 10,
  }));
  public static previewSpy = vi.fn(
    async (input: { value: number }, _ctx: IExecutePreviewContext) => ({
      out: input.value * -1,
    })
  );

  public static override readonly type = "RunnerVariants_IterChildSpyTask";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { out: { type: "number" } },
      required: ["out"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: number }, ctx: IExecuteContext) {
    return IterChildSpyTask.executeSpy(input, ctx);
  }
  override async executePreview(input: { value: number }, ctx: IExecutePreviewContext) {
    return IterChildSpyTask.previewSpy(input, ctx);
  }
}

/**
 * Scalar-input child used by FallbackTask, WhileTask, and GraphAsTask. Same
 * spy behaviour as IterChildSpyTask but with `additionalProperties: true` so
 * compound-task plumbing (e.g. `_iterations` on While) doesn't fail validation.
 */
class ScalarChildSpyTask extends Task<{ value: number }, { out: number }, TaskConfig> {
  public static override readonly type = "RunnerVariants_ScalarChildSpyTask";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { out: { type: "number" } },
      required: ["out"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
  executeSpy = vi.fn(async (input: { value: number }, _ctx: IExecuteContext) => ({
    out: (input.value ?? 0) * 10,
  }));
  previewSpy = vi.fn(async (input: { value: number }, _ctx: IExecutePreviewContext) => ({
    out: (input.value ?? 0) * -1,
  }));
  override async execute(input: { value: number }, ctx: IExecuteContext) {
    return this.executeSpy(input, ctx);
  }
  override async executePreview(input: { value: number }, ctx: IExecutePreviewContext) {
    return this.previewSpy(input, ctx);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("runner variants do not overlay executePreview after execute", () => {
  beforeEach(() => {
    IterChildSpyTask.executeSpy.mockClear();
    IterChildSpyTask.previewSpy.mockClear();
  });

  it("IteratorTaskRunner (MapTask): non-empty iteration returns iterated result without preview", async () => {
    const child = new IterChildSpyTask({ id: "child", defaults: { value: 0 } });
    const map = new MapTask({ maxIterations: "unbounded" });
    const subGraph = new TaskGraph();
    subGraph.addTask(child);
    map.subGraph = subGraph;

    const result = await map.run({ value: [1, 2, 3] });
    expect(IterChildSpyTask.executeSpy).toHaveBeenCalled();
    expect(IterChildSpyTask.previewSpy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("IteratorTaskRunner (MapTask): empty iteration returns empty result without preview", async () => {
    const child = new IterChildSpyTask({ id: "child", defaults: { value: 0 } });
    const map = new MapTask({ maxIterations: "unbounded" });
    const subGraph = new TaskGraph();
    subGraph.addTask(child);
    map.subGraph = subGraph;

    await map.run({ value: [] });
    expect(IterChildSpyTask.previewSpy).not.toHaveBeenCalled();
  });

  it("FallbackTaskRunner task mode: success returns alternative result without preview", async () => {
    const alternative = new ScalarChildSpyTask({
      id: "alt",
      defaults: { value: 0 },
    });
    const fallback = new FallbackTask({ fallbackMode: "task" });
    const subGraph = new TaskGraph();
    subGraph.addTask(alternative);
    fallback.subGraph = subGraph;

    await fallback.run({ value: 5 });
    expect(alternative.executeSpy).toHaveBeenCalled();
    expect(alternative.previewSpy).not.toHaveBeenCalled();
  });

  it("WhileTaskRunner: while loop result returned without preview overlay", async () => {
    const body = new ScalarChildSpyTask({ id: "body", defaults: { value: 0 } });
    let iters = 0;
    const whileTask = new WhileTask({
      maxIterations: 5,
      condition: () => iters++ < 1,
    });
    const subGraph = new TaskGraph();
    subGraph.addTask(body);
    whileTask.subGraph = subGraph;

    await whileTask.run({ value: 7 });
    expect(body.previewSpy).not.toHaveBeenCalled();
  });

  it("GraphAsTaskRunner compound run(): subgraph results returned without preview overlay", async () => {
    const child = new ScalarChildSpyTask({ id: "child", defaults: { value: 0 } });
    const compound = new GraphAsTask();
    const subGraph = new TaskGraph();
    subGraph.addTask(child);
    compound.subGraph = subGraph;

    await compound.run({ value: 3 });
    expect(child.executeSpy).toHaveBeenCalled();
    expect(child.previewSpy).not.toHaveBeenCalled();
  });

  it("GraphAsTaskRunner compound runPreview(): still propagates through subgraph", async () => {
    const child = new ScalarChildSpyTask({ id: "child", defaults: { value: 0 } });
    const compound = new GraphAsTask();
    const subGraph = new TaskGraph();
    subGraph.addTask(child);
    compound.subGraph = subGraph;

    await compound.runPreview({ value: 3 });
    expect(child.previewSpy).toHaveBeenCalled();
    expect(child.executeSpy).not.toHaveBeenCalled();
  });
});
