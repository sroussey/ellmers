/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput } from "@workglow/task-graph";
import {
  FallbackTask,
  Task,
  TaskAbortedError,
  TaskFailedError,
  TaskGraph,
  TaskStatus,
  Workflow,
  type CachePolicy,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, test } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

// ============================================================================
// Test Tasks
// ============================================================================

class SucceedingTask extends Task<{ value: number }, { result: number }> {
  public static override type = "FallbackTest_SucceedingTask";

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number", default: 0 } },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ result: number }> {
    return { result: (input.value ?? 0) * 10 };
  }
}

class FailingAlternativeTask extends Task<{ value: number }, { result: number }> {
  public static override type = "FallbackTest_FailingAlternativeTask";

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number", default: 0 } },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<{ result: number }> {
    throw new TaskFailedError("Alternative failed");
  }
}

class ConditionalFailTask extends Task<{ value: number }, { result: number }> {
  public static override type = "FallbackTest_ConditionalFailTask";

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number", default: 0 } },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ result: number }> {
    if (input.value < 5) {
      throw new TaskFailedError(`Value ${input.value} is too low`);
    }
    return { result: input.value * 100 };
  }
}

class SlowSucceedingTask extends Task<{ value: number }, { result: number }> {
  public static override type = "FallbackTest_SlowSucceedingTask";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number", default: 0 } },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: { value: number },
    context: IExecuteContext
  ): Promise<{ result: number }> {
    for (let elapsed = 0; elapsed < 300; elapsed += 10) {
      if (context.signal?.aborted) {
        throw new TaskAbortedError();
      }
      await sleep(10);
    }
    return { result: (input.value ?? 0) * 10 };
  }
}

// ============================================================================
// FallbackTask Unit Tests
// ============================================================================

describe("FallbackTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("FallbackTask", () => {
    describe("constructor and configuration", () => {
      test("should create with default task mode", () => {
        const task = new FallbackTask();
        expect(task.fallbackMode).toBe("task");
        expect(task.alternatives).toEqual([]);
      });

      test("should respect data mode configuration", () => {
        const alternatives = [{ model: "a" }, { model: "b" }];
        const task = new FallbackTask({ fallbackMode: "data", alternatives });
        expect(task.fallbackMode).toBe("data");
        expect(task.alternatives).toEqual(alternatives);
      });

      test("should have hasDynamicSchemas = true", () => {
        expect(FallbackTask.hasDynamicSchemas).toBe(true);
      });

      test("static properties are correct", () => {
        expect(FallbackTask.type).toBe("FallbackTask");
        expect(FallbackTask.category).toBe("Flow Control");
      });
    });

    describe("schema handling", () => {
      test("input and output schemas are defined", () => {
        const inputSchema = FallbackTask.inputSchema();
        const outputSchema = FallbackTask.outputSchema();
        expect(inputSchema).toBeDefined();
        expect(outputSchema).toBeDefined();
      });

      test("task mode input schema is union of all alternatives", () => {
        const task = new FallbackTask({ fallbackMode: "task" });
        const subGraph = new TaskGraph();
        subGraph.addTask(new SucceedingTask({ id: "alt1", defaults: { value: 0 } }));
        task.subGraph = subGraph;

        const schema = task.inputSchema();
        expect(typeof schema).toBe("object");
        if (typeof schema === "object") {
          expect(schema.properties).toHaveProperty("value");
        }
      });

      test("task mode output schema comes from first alternative", () => {
        const task = new FallbackTask({ fallbackMode: "task" });
        const subGraph = new TaskGraph();
        subGraph.addTask(new SucceedingTask({ id: "alt1", defaults: { value: 0 } }));
        task.subGraph = subGraph;

        const schema = task.outputSchema();
        expect(typeof schema).toBe("object");
        if (typeof schema === "object") {
          expect(schema.properties).toHaveProperty("result");
        }
      });
    });

    describe("serialization", () => {
      test("toJSON includes fallbackMode", () => {
        const task = new FallbackTask({ fallbackMode: "task", id: "test-fb" });
        const json = task.toJSON();
        expect(json.config).toBeDefined();
        expect((json.config as Record<string, unknown>).fallbackMode).toBe("task");
      });

      test("toJSON includes alternatives when present", () => {
        const alternatives = [{ model: "a" }, { model: "b" }];
        const task = new FallbackTask({ fallbackMode: "data", alternatives, id: "test-fb" });
        const json = task.toJSON();
        expect((json.config as Record<string, unknown>).alternatives).toEqual(alternatives);
      });
    });
  });

  // ============================================================================
  // Task Mode Execution
  // ============================================================================

  describe("FallbackTask - Task Mode Execution", () => {
    test("first alternative succeeds - returns its output", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SucceedingTask({ id: "alt1", defaults: { value: 0 } }));
      subGraph.addTask(new SucceedingTask({ id: "alt2", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const result = await task.run({ value: 5 } as TaskInput);
      expect(result.result).toBe(50);
    });

    test("first fails, second succeeds - returns second's output", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      subGraph.addTask(new FailingAlternativeTask({ id: "alt1", defaults: { value: 0 } }));
      subGraph.addTask(new SucceedingTask({ id: "alt2", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const result = await task.run({ value: 3 } as TaskInput);
      expect(result.result).toBe(30);
    });

    test("all alternatives fail - throws aggregate error", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      subGraph.addTask(new FailingAlternativeTask({ id: "alt1", defaults: { value: 0 } }));
      subGraph.addTask(new FailingAlternativeTask({ id: "alt2", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      await expect(task.run({ value: 1 } as TaskInput)).rejects.toThrow(
        "All 2 alternatives failed"
      );
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    test("no alternatives - throws error", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      task.subGraph = new TaskGraph();

      await expect(task.run({ value: 1 } as TaskInput)).rejects.toThrow(
        "FallbackTask has no alternatives to try"
      );
    });

    test("skips remaining alternatives after first success", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SucceedingTask({ id: "alt1", defaults: { value: 0 } }));
      subGraph.addTask(new FailingAlternativeTask({ id: "alt2", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      // alt1 succeeds, alt2 (which would fail) is never tried
      const result = await task.run({ value: 7 } as TaskInput);
      expect(result.result).toBe(70);
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });
  });

  // ============================================================================
  // Data Mode Execution
  // ============================================================================

  describe("FallbackTask - Data Mode Execution", () => {
    test("first data alternative succeeds", async () => {
      const task = new FallbackTask({
        fallbackMode: "data",
        alternatives: [{ value: 10 }, { value: 20 }],
      });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SucceedingTask({ id: "template", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const result = await task.run({} as TaskInput);
      expect(result.result).toBe(100); // 10 * 10
    });

    test("first data alternative fails, second succeeds", async () => {
      const task = new FallbackTask({
        fallbackMode: "data",
        alternatives: [{ value: 2 }, { value: 10 }],
      });
      const subGraph = new TaskGraph();
      subGraph.addTask(new ConditionalFailTask({ id: "template", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const result = await task.run({} as TaskInput);
      expect(result.result).toBe(1000); // 10 * 100
    });

    test("all data alternatives fail - throws aggregate error", async () => {
      const task = new FallbackTask({
        fallbackMode: "data",
        alternatives: [{ value: 1 }, { value: 2 }],
      });
      const subGraph = new TaskGraph();
      subGraph.addTask(new ConditionalFailTask({ id: "template", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      await expect(task.run({} as TaskInput)).rejects.toThrow("All 2 data alternatives failed");
    });

    test("no data alternatives - throws error", async () => {
      const task = new FallbackTask({ fallbackMode: "data", alternatives: [] });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SucceedingTask({ id: "template", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      await expect(task.run({} as TaskInput)).rejects.toThrow(
        "FallbackTask has no data alternatives to try"
      );
    });

    test("data mode merges alternative with original input", async () => {
      const task = new FallbackTask({
        fallbackMode: "data",
        alternatives: [{ value: 7 }],
      });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SucceedingTask({ id: "template", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      // Original input is empty, alternative provides value: 7
      const result = await task.run({} as TaskInput);
      expect(result.result).toBe(70); // 7 * 10
    });

    test("data mode progress surfaces inner graph_progress between attempt boundaries", async () => {
      // A child task that reports progress=50 mid-execution. Pre-fix, the
      // FallbackTaskRunner only emitted at attempt boundaries (synthetic "Trying X/N"
      // and "Succeeded X/N" markers), so inner streaming was invisible to the outer
      // progress bar. With the graph_progress subscription in executeDataFallback,
      // we should see blended values between each pair of attempt markers.
      class MidProgressTask extends Task<{ value: number }, { result: number }> {
        public static override type = "FallbackTest_DataMidProgressTask";
        public static override cachePolicy: CachePolicy = { kind: "none" };

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { value: { type: "number", default: 0 } },
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { result: { type: "number" } },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(
          input: { value: number },
          context: IExecuteContext
        ): Promise<{ result: number }> {
          await sleep(5);
          await context.updateProgress(50, "halfway");
          await sleep(5);
          // First two attempts fail; third succeeds (value >= 5).
          if ((input.value ?? 0) < 5) {
            throw new TaskFailedError(`Value ${input.value} is too low`);
          }
          return { result: (input.value ?? 0) * 10 };
        }
      }

      const task = new FallbackTask({
        fallbackMode: "data",
        alternatives: [{ value: 1 }, { value: 2 }, { value: 7 }],
      });
      const subGraph = new TaskGraph();
      subGraph.addTask(new MidProgressTask({ id: "template", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const events: Array<{ progress: number | undefined; message?: string }> = [];
      task.events.on("progress", (progress: number | undefined, message?: string) => {
        events.push({ progress: progress, message });
      });

      const result = await task.run({} as TaskInput);
      expect(result.result).toBe(70);

      // Pre-fix, the only messages emitted during execution were the runner's synthetic
      // boundary markers ("Trying data alternative X/N", "Data alternative X/N succeeded").
      // Post-fix, the inner child task's "halfway" message should surface via the
      // subgraph's `graph_progress` relay. We observe it N times (once per attempt —
      // 3 total for this test) since the subgraph runs fresh each attempt.
      const halfwayEvents = events.filter((e) => e.message === "halfway");
      expect(halfwayEvents.length).toBeGreaterThanOrEqual(3);

      // Every emitted progress value must be in [0, 100] and non-decreasing so the
      // blended progress never regresses past a boundary marker.
      for (const e of events) {
        if (e.progress === undefined) {
          throw new Error("Expected progress event to include a numeric progress value");
        }
        expect(e.progress).toBeGreaterThanOrEqual(0);
        expect(e.progress).toBeLessThanOrEqual(100);
      }
      for (let i = 1; i < events.length; i++) {
        const currentProgress = events[i]?.progress;
        const previousProgress = events[i - 1]?.progress;
        if (currentProgress === undefined || previousProgress === undefined) {
          throw new Error("Expected adjacent progress events to include numeric progress values");
        }
        expect(currentProgress).toBeGreaterThanOrEqual(previousProgress);
      }

      // Progress on successful completion must reach 100.
      const last = events[events.length - 1];
      expect(last?.progress).toBe(100);
    });
  });

  // ============================================================================
  // Workflow API Tests
  // ============================================================================

  describe("FallbackTask - Workflow API", () => {
    test("Workflow should have fallback method", () => {
      const workflow = new Workflow();
      expect(typeof workflow.fallback).toBe("function");
    });

    test("Workflow should have fallbackWith method", () => {
      const workflow = new Workflow();
      expect(typeof workflow.fallbackWith).toBe("function");
    });

    test("fallback should return a loop builder with endFallback", () => {
      const workflow = new Workflow();
      const builder = workflow.fallback();
      expect(builder).toBeDefined();
      expect(typeof builder.endFallback).toBe("function");
    });

    test("fallbackWith should return a loop builder with endFallbackWith", () => {
      const workflow = new Workflow();
      const builder = workflow.fallbackWith([{ value: 1 }]);
      expect(builder).toBeDefined();
      expect(typeof builder.endFallbackWith).toBe("function");
    });

    test("fallback should add a FallbackTask to the graph", () => {
      const workflow = new Workflow();
      workflow.fallback().addTask(SucceedingTask).endFallback();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeInstanceOf(FallbackTask);
      expect((tasks[0] as FallbackTask).fallbackMode).toBe("task");
    });

    test("fallbackWith should add a FallbackTask with data mode", () => {
      const alternatives = [{ value: 1 }, { value: 2 }];
      const workflow = new Workflow();
      workflow.fallbackWith(alternatives).addTask(SucceedingTask).endFallbackWith();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      const fallbackTask = tasks[0] as FallbackTask;
      expect(fallbackTask).toBeInstanceOf(FallbackTask);
      expect(fallbackTask.fallbackMode).toBe("data");
      expect(fallbackTask.alternatives).toEqual(alternatives);
    });

    test("fallback with multiple alternatives in subgraph", () => {
      const workflow = new Workflow();
      workflow.fallback().addTask(FailingAlternativeTask).addTask(SucceedingTask).endFallback();

      const fallbackTask = workflow.graph.getTasks()[0] as FallbackTask;
      expect(fallbackTask.subGraph.getTasks()).toHaveLength(2);
      expect(fallbackTask.subGraph.getTasks()[0]).toBeInstanceOf(FailingAlternativeTask);
      expect(fallbackTask.subGraph.getTasks()[1]).toBeInstanceOf(SucceedingTask);
    });
  });

  // ============================================================================
  // Workflow Execution Tests
  // ============================================================================

  describe("FallbackTask - Workflow Execution", () => {
    test("task fallback workflow - first succeeds", async () => {
      const workflow = new Workflow();
      workflow.fallback().addTask(SucceedingTask).addTask(FailingAlternativeTask).endFallback();

      const result = await workflow.run({ value: 4 });
      expect(result.result).toBe(40);
    });

    test("task fallback workflow - first fails, second succeeds", async () => {
      const workflow = new Workflow();
      workflow.fallback().addTask(FailingAlternativeTask).addTask(SucceedingTask).endFallback();

      const result = await workflow.run({ value: 3 });
      expect(result.result).toBe(30);
    });

    test("task fallback workflow - all fail", async () => {
      const workflow = new Workflow();
      workflow
        .fallback()
        .addTask(FailingAlternativeTask)
        .addTask(FailingAlternativeTask)
        .endFallback();

      await expect(workflow.run({ value: 1 })).rejects.toThrow("All 2 alternatives failed");
    });

    test("data fallback workflow - first alternative succeeds", async () => {
      const workflow = new Workflow();
      workflow
        .fallbackWith([{ value: 10 }, { value: 20 }])
        .addTask(SucceedingTask)
        .endFallbackWith();

      const result = await workflow.run({});
      expect(result.result).toBe(100); // 10 * 10
    });

    test("data fallback workflow - fallback to second alternative", async () => {
      const workflow = new Workflow();
      workflow
        .fallbackWith([{ value: 2 }, { value: 10 }])
        .addTask(ConditionalFailTask)
        .endFallbackWith();

      const result = await workflow.run({});
      expect(result.result).toBe(1000); // 10 * 100
    });

    test("chaining fallback with other tasks", async () => {
      const workflow = new Workflow();
      workflow.fallback().addTask(FailingAlternativeTask).addTask(SucceedingTask).endFallback();

      const result = await workflow.run({ value: 5 });
      expect(result.result).toBe(50);
    });
  });

  // ============================================================================
  // Timeout & Abort Integration
  // ============================================================================

  describe("FallbackTask - Timeout & Abort", () => {
    test("task mode: timed-out alternative is retryable, falls back to next", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      // First alternative: slow task with a tight timeout (will time out)
      const slowTask = new SlowSucceedingTask({ id: "slow", timeout: 50, defaults: { value: 0 } });
      // Second alternative: fast succeeding task
      subGraph.addTask(slowTask);
      subGraph.addTask(new SucceedingTask({ id: "fast", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const result = await task.run({ value: 4 } as TaskInput);
      expect(result.result).toBe(40);
    });

    test("task mode: slow first alternative times out, fast second succeeds", async () => {
      // The slow task with a tight timeout will be aborted by TaskTimeoutError.
      // Since timeouts are retryable, the fallback should try the second alternative.
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SlowSucceedingTask({ id: "slow", timeout: 50, defaults: { value: 0 } }));
      subGraph.addTask(new SucceedingTask({ id: "fast", defaults: { value: 0 } }));
      task.subGraph = subGraph;

      const result = await task.run({ value: 8 } as TaskInput);
      // The slow task times out, fallback goes to fast task: 8 * 10 = 80
      expect(result.result).toBe(80);
    });

    test("aggregate error labels timeout failures distinctly", async () => {
      const task = new FallbackTask({ fallbackMode: "task" });
      const subGraph = new TaskGraph();
      // Both alternatives time out
      subGraph.addTask(
        new SlowSucceedingTask({ id: "slow1", timeout: 50, defaults: { value: 0 } })
      );
      subGraph.addTask(
        new SlowSucceedingTask({ id: "slow2", timeout: 50, defaults: { value: 0 } })
      );
      task.subGraph = subGraph;

      await expect(task.run({ value: 1 } as TaskInput)).rejects.toThrow("[timeout]");
    });
  });
});
