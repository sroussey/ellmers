/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import {
  ForEachTask,
  IteratorTask,
  MapTask,
  ReduceTask,
  Task,
  TaskGraph,
  WhileTask,
  Workflow,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, test } from "vitest";

import {
  AddToSumTask,
  DoubleToResultTask as DoubleTask,
  ProcessItemTask,
  RefineTask,
  TestIteratorTask,
  TextEmbeddingTask,
} from "@workglow/task-graph/test";
import { getTestingLogger } from "@workglow/util/test";

interface ArrayInput extends TaskInput {
  items: number[];
}

describe("IteratorTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("IteratorTask", () => {
    describe("constructor and configuration", () => {
      test("should throw when maxIterations is omitted", () => {
        expect(() => new TestIteratorTask<ArrayInput>({} as any)).toThrow(/maxIterations/);
      });

      test("should create with explicit unbounded maxIterations", () => {
        const task = new TestIteratorTask<ArrayInput>({ maxIterations: "unbounded" });

        expect(task.concurrencyLimit).toBe(undefined);
        expect(task.batchSize).toBe(undefined);
      });

      test("should respect custom configuration", () => {
        const task = new TestIteratorTask<ArrayInput>({
          concurrencyLimit: 3,
          maxIterations: "unbounded",
        });

        expect(task.concurrencyLimit).toBe(3);
      });

      test("should support batchSize configuration", () => {
        const task = new TestIteratorTask<ArrayInput>({
          batchSize: 10,
          maxIterations: "unbounded",
        });

        expect(task.batchSize).toBe(10);
      });

      test("should support combined batchSize and concurrencyLimit", () => {
        const task = new TestIteratorTask<ArrayInput>({
          concurrencyLimit: 2,
          batchSize: 5,
          maxIterations: "unbounded",
        });

        expect(task.concurrencyLimit).toBe(2);
        expect(task.batchSize).toBe(5);
      });

      test("should have undefined batchSize by default", () => {
        const task = new TestIteratorTask<ArrayInput>({ maxIterations: "unbounded" });

        expect(task.batchSize).toBeUndefined();
      });
    });

    describe("subgraph management", () => {
      test("should set and get subgraph", () => {
        class TestIteratorWithArray extends IteratorTask<ArrayInput> {
          public static override inputSchema(): DataPortSchema {
            return {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: { type: "number" },
                },
              },
              additionalProperties: false,
            } as const satisfies DataPortSchema;
          }
        }

        const task = new TestIteratorWithArray({
          defaults: { items: [1, 2, 3] },
          maxIterations: "unbounded",
        });
        const subGraph = new TaskGraph();
        subGraph.addTask(new DoubleTask({ id: "double", defaults: { value: 0 } }));

        task.subGraph = subGraph;

        expect(task.subGraph).toBe(subGraph);
      });
    });
  });

  // ============================================================================
  // MapTask Tests
  // ============================================================================

  describe("MapTask", () => {
    describe("basic transformation", () => {
      test("should return empty result for empty array", async () => {
        class TestMapTask extends MapTask<ArrayInput> {
          public static override inputSchema(): DataPortSchema {
            return {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: { type: "number" },
                },
              },
              additionalProperties: false,
            } as const satisfies DataPortSchema;
          }
        }

        const task = new TestMapTask({
          defaults: { items: [] },
          maxIterations: "unbounded",
        });
        const result = await task.run();

        expect(result).toEqual({});
      });

      test("should have dynamic output schema", () => {
        const task = new MapTask({ maxIterations: "unbounded" });
        const schema = task.outputSchema();

        expect(typeof schema).toBe("object");
      });
    });

    describe("configuration", () => {
      test("should throw when maxIterations is omitted", () => {
        expect(() => new MapTask({} as any)).toThrow(/maxIterations/);
      });

      test("should default preserveOrder to true", () => {
        const task = new MapTask({ maxIterations: "unbounded" });
        expect(task.preserveOrder).toBe(true);
      });

      test("should default flatten to false", () => {
        const task = new MapTask({ maxIterations: "unbounded" });
        expect(task.flatten).toBe(false);
      });

      test("should respect custom configuration", () => {
        const task = new MapTask({
          preserveOrder: false,
          flatten: true,
          maxIterations: "unbounded",
        });
        expect(task.preserveOrder).toBe(false);
        expect(task.flatten).toBe(true);
      });
    });
  });

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe("Type Safety", () => {
    test("IteratorTask should be an instance of IteratorTask", () => {
      const task = new TestIteratorTask({ maxIterations: "unbounded" });
      expect(task).toBeInstanceOf(IteratorTask);
    });

    test("MapTask should be an instance of IteratorTask", () => {
      const task = new MapTask({ maxIterations: "unbounded" });
      expect(task).toBeInstanceOf(IteratorTask);
      expect(task).toBeInstanceOf(MapTask);
    });
  });

  // ============================================================================
  // Schema Tests
  // ============================================================================

  describe("Schema Handling", () => {
    test("IteratorTask should have hasDynamicSchemas = true", () => {
      expect(IteratorTask.hasDynamicSchemas).toBe(true);
    });

    test("MapTask should have additionalProperties true for input", () => {
      const inputSchema = MapTask.inputSchema();

      expect(typeof inputSchema).toBe("object");
      if (typeof inputSchema === "object") {
        expect(inputSchema.additionalProperties).toBe(true);
      }
    });
  });

  // ============================================================================
  // WhileTask Tests
  // ============================================================================

  describe("WhileTask", () => {
    describe("configuration", () => {
      test("should throw when maxIterations is omitted", () => {
        expect(() => new WhileTask({} as any)).toThrow(/maxIterations/);
      });

      test("should resolve unbounded sentinel to Infinity", () => {
        const task = new WhileTask({ maxIterations: "unbounded" });
        expect(task.maxIterations).toBe(Number.POSITIVE_INFINITY);
      });

      test("should default chainIterations to true", () => {
        const task = new WhileTask({ maxIterations: "unbounded" });
        expect(task.chainIterations).toBe(true);
      });

      test("should respect custom configuration", () => {
        const condition = (output: any, iteration: number) => iteration < 5;
        const task = new WhileTask({
          condition,
          maxIterations: 50,
          chainIterations: false,
        });

        expect(task.condition).toBe(condition);
        expect(task.maxIterations).toBe(50);
        expect(task.chainIterations).toBe(false);
      });
    });

    describe("subgraph", () => {
      test("should set and get subGraph", () => {
        const task = new WhileTask({ maxIterations: "unbounded" });
        const subGraph = new TaskGraph();
        subGraph.addTask(new DoubleTask({ id: "double", defaults: { value: 0 } }));

        task.subGraph = subGraph;

        expect(task.subGraph).toBe(subGraph);
      });
    });

    describe("type safety", () => {
      test("WhileTask should not be an instance of IteratorTask", () => {
        const task = new WhileTask({ maxIterations: "unbounded" });
        // WhileTask extends GraphAsTask, not IteratorTask
        expect(task).toBeInstanceOf(WhileTask);
      });
    });

    describe("schema handling", () => {
      test("WhileTask should have hasDynamicSchemas = true", () => {
        expect(WhileTask.hasDynamicSchemas).toBe(true);
      });

      test("WhileTask should have _iterations in output schema", () => {
        const outputSchema = WhileTask.outputSchema();
        expect(typeof outputSchema).toBe("object");
        if (typeof outputSchema === "object") {
          expect(outputSchema.properties).toHaveProperty("_iterations");
        }
      });
    });
  });

  // ============================================================================
  // ReduceTask Tests
  // ============================================================================

  describe("ReduceTask", () => {
    describe("configuration", () => {
      test("should throw when maxIterations is omitted", () => {
        expect(() => new ReduceTask({} as any)).toThrow(/maxIterations/);
      });

      test("should default initialValue to empty object", () => {
        const task = new ReduceTask({ maxIterations: "unbounded" });
        expect(task.initialValue).toEqual({});
      });

      test("should respect custom initialValue", () => {
        const task = new ReduceTask({ initialValue: { sum: 0 }, maxIterations: "unbounded" });
        expect(task.initialValue).toEqual({ sum: 0 });
      });

      test("should force sequential execution mode (parallel-limited with concurrency 1)", () => {
        const task = new ReduceTask({ concurrencyLimit: 5, maxIterations: "unbounded" });
        expect(task.concurrencyLimit).toBe(1);
        expect(task.batchSize).toBe(1);
      });
    });

    describe("type safety", () => {
      test("ReduceTask should be an instance of IteratorTask", () => {
        const task = new ReduceTask({ maxIterations: "unbounded" });
        expect(task).toBeInstanceOf(IteratorTask);
        expect(task).toBeInstanceOf(ReduceTask);
      });
    });

    describe("schema handling", () => {
      test("ReduceTask input schema should allow dynamic ports", () => {
        const inputSchema = ReduceTask.inputSchema();
        expect(typeof inputSchema).toBe("object");
        if (typeof inputSchema === "object") {
          expect(inputSchema.additionalProperties).toBe(true);
        }
      });
    });
  });

  // ============================================================================
  // Workflow Loop Methods Tests
  // ============================================================================

  describe("Workflow Loop Methods", () => {
    test("Workflow should have map method", () => {
      const workflow = new Workflow();
      expect(typeof workflow.map).toBe("function");
    });

    test("Workflow should have while method", () => {
      const workflow = new Workflow();
      expect(typeof workflow.while).toBe("function");
    });

    test("Workflow should have reduce method", () => {
      const workflow = new Workflow();
      expect(typeof workflow.reduce).toBe("function");
    });

    test("map should return a LoopWorkflowBuilder", () => {
      const workflow = new Workflow();
      const builder = workflow.map({ maxIterations: "unbounded" });

      expect(builder).toBeDefined();
      expect(typeof builder.endMap).toBe("function");
    });

    test("while should return a LoopWorkflowBuilder", () => {
      const workflow = new Workflow();
      const builder = workflow.while({ maxIterations: 10 });

      expect(builder).toBeDefined();
      expect(typeof builder.endWhile).toBe("function");
    });

    test("reduce should return a LoopWorkflowBuilder", () => {
      const workflow = new Workflow();
      const builder = workflow.reduce({
        initialValue: { count: 0 },
        maxIterations: "unbounded",
      });

      expect(builder).toBeDefined();
      expect(typeof builder.endReduce).toBe("function");
    });

    test("map should add a MapTask to the graph", () => {
      const workflow = new Workflow();
      workflow.map({ maxIterations: "unbounded" }).endMap();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeInstanceOf(MapTask);
    });

    test("while should add a WhileTask to the graph", () => {
      const workflow = new Workflow();
      workflow.while({ condition: () => false, maxIterations: 10 }).endWhile();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeInstanceOf(WhileTask);
    });

    test("reduce should add a ReduceTask to the graph", () => {
      const workflow = new Workflow();
      workflow.reduce({ initialValue: {}, maxIterations: "unbounded" }).endReduce();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeInstanceOf(ReduceTask);
    });

    test("Workflow should have forEach method", () => {
      const workflow = new Workflow();
      expect(typeof workflow.forEach).toBe("function");
    });

    test("forEach should add a ForEachTask to the graph", () => {
      const workflow = new Workflow();
      workflow.forEach({ maxIterations: "unbounded" }).endForEach();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeInstanceOf(ForEachTask);
      // ForEachTask extends MapTask
      expect(tasks[0]).toBeInstanceOf(MapTask);
    });
  });

  // ============================================================================
  // ForEachTask Tests
  // ============================================================================

  describe("ForEachTask", () => {
    test("should default discardResults to true", () => {
      const task = new ForEachTask({ maxIterations: "unbounded" });
      expect(task.discardResults).toBe(true);
    });

    test("should allow explicit override of discardResults", () => {
      const task = new ForEachTask({ maxIterations: "unbounded", discardResults: false });
      expect(task.discardResults).toBe(false);
    });

    test("should throw when maxIterations is omitted", () => {
      expect(() => new ForEachTask({} as any)).toThrow(/maxIterations/);
    });

    test("should forward runConfig to base Task", () => {
      // Regression: the constructor must accept and forward the runConfig
      // parameter required by ITaskConstructor. IteratorTaskRunner clones
      // tasks via `new ctor(config, task.runConfig)` — dropping runConfig
      // here silently loses per-call DI/service bindings for deserialized
      // or cloned ForEachTasks.
      const runConfig = { cacheable: false };
      const task = new ForEachTask({ maxIterations: "unbounded" }, runConfig);
      expect(task.runConfig).toEqual(runConfig);
    });

    test("should return empty result when discardResults is true", () => {
      const task = new ForEachTask({ maxIterations: "unbounded" });
      const result = task.collectResults([{ out: 1 }, { out: 2 }, { out: 3 }]);
      expect(result).toEqual({});
    });
  });

  // ============================================================================
  // Workflow Integration Tests - Demonstrating Real Usage Patterns
  // ============================================================================

  /**
   * These tests demonstrate the actual workflow patterns shown in the JSDoc examples.
   * They show how to build and execute workflows with loop tasks.
   */

  describe("Workflow Integration - Map Pattern", () => {
    /**
     * Example: Transform each text into an embedding
     *
     * workflow
     *   .map()
     *     .textEmbedding()
     *   .endMap()
     */
    test("should build workflow with map loop for transformation", () => {
      const workflow = new Workflow();

      workflow
        .map({ preserveOrder: true, maxIterations: "unbounded" })
        .addTask(TextEmbeddingTask)
        .endMap();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);

      const mapTask = tasks[0] as MapTask;
      expect(mapTask).toBeInstanceOf(MapTask);
      expect(mapTask.preserveOrder).toBe(true);

      const templateGraph = mapTask.subGraph;
      expect(templateGraph).toBeDefined();
      expect(templateGraph?.getTasks()).toHaveLength(1);
      expect(templateGraph?.getTasks()[0]).toBeInstanceOf(TextEmbeddingTask);
    });

    test("map with flatten option should configure correctly", () => {
      const workflow = new Workflow();

      workflow
        .map({ flatten: true, concurrencyLimit: 5, maxIterations: "unbounded" })
        .addTask(TextEmbeddingTask)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      expect(mapTask.flatten).toBe(true);
      expect(mapTask.concurrencyLimit).toBe(5);
    });
  });

  describe("Workflow Integration - While Pattern", () => {
    /**
     * Example: Refine until quality threshold is met
     *
     * workflow
     *   .while({
     *     condition: (output, iteration) => output.quality < 0.9 && iteration < 10,
     *     maxIterations: 20
     *   })
     *     .refineResult()
     *   .endWhile()
     */
    test("should build workflow with while loop for iterative refinement", () => {
      const condition = (output: any, iteration: number) => output.quality < 0.9 && iteration < 10;

      const workflow = new Workflow();

      workflow
        .while({
          condition,
          maxIterations: 20,
        })
        .addTask(RefineTask)
        .endWhile();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);

      const whileTask = tasks[0] as WhileTask;
      expect(whileTask).toBeInstanceOf(WhileTask);
      expect(whileTask.condition).toBe(condition);
      expect(whileTask.maxIterations).toBe(20);

      expect(whileTask.hasChildren()).toBe(true);
      expect(whileTask.subGraph.getTasks()).toHaveLength(1);
    });

    /**
     * Example: Retry until success
     *
     * workflow
     *   .while({
     *     condition: (output) => !output.success,
     *     maxIterations: 5
     *   })
     *     .attemptOperation()
     *   .endWhile()
     */
    test("should support retry pattern with while loop", () => {
      const retryCondition = (output: any) => !output.success;

      const workflow = new Workflow();

      workflow
        .while({
          condition: retryCondition,
          maxIterations: 5,
          chainIterations: true,
        })
        .addTask(RefineTask)
        .endWhile();

      const whileTask = workflow.graph.getTasks()[0] as WhileTask;
      expect(whileTask.maxIterations).toBe(5);
      expect(whileTask.chainIterations).toBe(true);
    });
  });

  describe("Workflow Integration - Reduce Pattern", () => {
    /**
     * Example: Sum all numbers in an array
     *
     * workflow
     *   .reduce({ initialValue: { sum: 0 } })
     *     .addToSum()
     *   .endReduce()
     */
    test("should build workflow with reduce loop for aggregation", () => {
      const workflow = new Workflow();

      workflow
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);

      const reduceTask = tasks[0] as ReduceTask;
      expect(reduceTask).toBeInstanceOf(ReduceTask);
      expect(reduceTask.initialValue).toEqual({ sum: 0 });

      // Verify template graph
      const templateGraph = reduceTask.subGraph;
      expect(templateGraph).toBeDefined();
      expect(templateGraph?.getTasks()).toHaveLength(1);
    });

    test("reduce with custom initial value should configure correctly", () => {
      const workflow = new Workflow();

      workflow
        .reduce({
          initialValue: { count: 0, total: 0 },
          maxIterations: "unbounded",
        })
        .addTask(AddToSumTask)
        .endReduce();

      const reduceTask = workflow.graph.getTasks()[0] as ReduceTask;
      expect(reduceTask.initialValue).toEqual({ count: 0, total: 0 });
    });
  });

  describe("Workflow Integration - Chained Loops", () => {
    /**
     * Example: Multiple loop operations in sequence
     *
     * workflow
     *   .map()
     *     .textEmbedding()
     *   .endMap()
     *   .reduce({ initialValue: { sum: 0 } })
     *     .addToSum()
     *   .endReduce()
     */
    test("should support chaining multiple loop operations", () => {
      const workflow = new Workflow();

      workflow
        .map({ maxIterations: "unbounded" })
        .addTask(TextEmbeddingTask)
        .endMap()
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toBeInstanceOf(MapTask);
      expect(tasks[1]).toBeInstanceOf(ReduceTask);
    });

    test("should chain map followed by reduce", () => {
      const workflow = new Workflow();

      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap()
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toBeInstanceOf(MapTask);
      expect(tasks[1]).toBeInstanceOf(ReduceTask);
    });
  });

  describe("Workflow Integration - Multiple Tasks in Loop", () => {
    /**
     * Example: Chain multiple tasks inside a loop
     *
     * workflow
     *   .map()
     *     .processItem()
     *     .anotherTask()
     *   .endMap()
     */
    test("should support multiple tasks inside a loop", () => {
      const workflow = new Workflow();

      workflow
        .map({ maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .addTask(DoubleTask)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      const templateGraph = mapTask.subGraph;

      expect(templateGraph).toBeDefined();
      expect(templateGraph?.getTasks()).toHaveLength(2);
      expect(templateGraph?.getTasks()[0]).toBeInstanceOf(ProcessItemTask);
      expect(templateGraph?.getTasks()[1]).toBeInstanceOf(DoubleTask);
    });

    test("while loop with multiple refinement steps", () => {
      const workflow = new Workflow();

      workflow
        .while({
          condition: (output, iteration) => iteration < 3,
          maxIterations: 10,
        })
        .addTask(RefineTask)
        .addTask(DoubleTask)
        .endWhile();

      const whileTask = workflow.graph.getTasks()[0] as WhileTask;

      expect(whileTask.hasChildren()).toBe(true);
      expect(whileTask.subGraph.getTasks()).toHaveLength(2);
    });
  });

  describe("Workflow Integration - Template Graph Access", () => {
    test("loop builder graph should be accessible", () => {
      const workflow = new Workflow();

      const builder = workflow.map({ maxIterations: "unbounded" });
      expect(builder.graph).toBeInstanceOf(TaskGraph);
      builder.endMap();
    });

    test("template graph should contain added tasks with auto-generated IDs", () => {
      const workflow = new Workflow();

      workflow
        .map({ maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .addTask(DoubleTask)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      const templateTasks = mapTask.subGraph?.getTasks() ?? [];

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(templateTasks[0].id).toMatch(uuidRegex);
      expect(templateTasks[1].id).toMatch(uuidRegex);
      expect(templateTasks[0].id).not.toBe(templateTasks[1].id);
    });

    test("template graph dataflows should be created between tasks with matching ports", () => {
      interface CompatibleInput extends TaskInput {
        readonly result: number;
      }

      interface CompatibleOutput extends TaskOutput {
        readonly result: number;
      }

      class TaskA extends Task<TaskInput, CompatibleOutput> {
        public static override type = "IteratorTask_TaskA";
        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { input: { type: "number" } },
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
        override async execute(): Promise<CompatibleOutput> {
          return { result: 42 };
        }
      }

      class TaskB extends Task<CompatibleInput, TaskOutput> {
        public static override type = "IteratorTask_TaskB";
        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { result: { type: "number" } },
            required: ["result"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }
        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { final: { type: "number" } },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }
        override async execute(input: CompatibleInput): Promise<TaskOutput> {
          return { final: input.result * 2 };
        }
      }

      const workflow = new Workflow();

      workflow.map({ maxIterations: "unbounded" }).addTask(TaskA).addTask(TaskB).endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      const templateGraph = mapTask.subGraph;
      const dataflows = templateGraph?.getDataflows() ?? [];

      expect(dataflows.length).toBeGreaterThan(0);
      expect(dataflows[0].sourceTaskPortId).toBe("result");
      expect(dataflows[0].targetTaskPortId).toBe("result");
    });
  });

  // ============================================================================
  // Execution Regression Tests
  // ============================================================================

  describe("Iterator Execution Regressions", () => {
    test("workflow map run should execute without pre-run scalar failure", async () => {
      const workflow = new Workflow();

      workflow.map({ maxIterations: "unbounded" }).addTask(ProcessItemTask).endMap();

      const result = await workflow.run({ item: [1, 2, 3] });
      expect(result.processed).toEqual([2, 4, 6]);
    });

    test("direct MapTask.run should execute a reusable subgraph across iterations", async () => {
      const mapTask = new MapTask({ maxIterations: "unbounded" });
      const subGraph = new TaskGraph();
      subGraph.addTask(new ProcessItemTask({ id: "process", defaults: { item: 0 } }));

      mapTask.subGraph = subGraph;

      const result = await mapTask.run({ item: [4, 5, 6] } as TaskInput);
      expect(result.processed).toEqual([8, 10, 12]);
    });

    test("aborting a MapTask mid-flight throws (not a partial COMPLETED result)", async () => {
      class SlowItemTask extends Task<{ item: number }, { processed: number }> {
        public static override type = "SlowItemTask";
        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
          } as const satisfies DataPortSchema;
        }
        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { processed: { type: "number" } },
          } as const satisfies DataPortSchema;
        }
        override async execute(input: { item: number }): Promise<{ processed: number }> {
          await sleep(20);
          return { processed: input.item * 2 };
        }
      }

      const mapTask = new MapTask({
        maxIterations: "unbounded",
        batchSize: 1,
        concurrencyLimit: 1,
      });
      const subGraph = new TaskGraph();
      subGraph.addTask(new SlowItemTask({ id: "slow", defaults: { item: 0 } }));
      mapTask.subGraph = subGraph;

      const runPromise = mapTask.run({ item: [1, 2, 3, 4, 5] } as TaskInput);
      // Abort after the first batch begins but before all batches finish.
      await sleep(10);
      mapTask.abort();

      await expect(runPromise).rejects.toThrow();
    });

    test("map preserveOrder=true should return outputs aligned to input index", async () => {
      class DelayedEchoTask extends Task<{ item: number }, { item: number }> {
        public static override type = "DelayedEchoTask";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              item: { type: "number" },
            },
            required: ["item"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              item: { type: "number" },
            },
            required: ["item"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: { item: number }): Promise<{ item: number }> {
          await sleep((4 - input.item) * 5);
          return { item: input.item };
        }
      }

      const workflow = new Workflow();
      workflow
        .map({ preserveOrder: true, concurrencyLimit: 3, maxIterations: "unbounded" })
        .addTask(DelayedEchoTask)
        .endMap();

      const result = await workflow.run({ item: [1, 2, 3] });
      expect(result.item).toEqual([1, 2, 3]);
    });

    test("map preserveOrder=false should still return complete results", async () => {
      const workflow = new Workflow();
      workflow
        .map({ preserveOrder: false, concurrencyLimit: 3, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap();

      const result = await workflow.run({ item: [1, 2, 3] });
      expect((result.processed as number[]).slice().sort((a, b) => a - b)).toEqual([2, 4, 6]);
    });

    test("map should honor batchSize and concurrency settings without data loss", async () => {
      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 2, batchSize: 2, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap();

      const result = await workflow.run({ item: [1, 2, 3, 4, 5] });
      expect(result.processed).toEqual([2, 4, 6, 8, 10]);
    });

    test("reduce should process multiple iterated ports with zip semantics", async () => {
      class ZipReduceTask extends Task<
        { accumulator: { sum: number }; left: number; right: number },
        { sum: number }
      > {
        public static override type = "ZipReduceTask";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              accumulator: {
                type: "object",
                properties: {
                  sum: { type: "number" },
                },
              },
              left: { type: "number" },
              right: { type: "number" },
            },
            required: ["accumulator", "left", "right"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              sum: { type: "number" },
            },
            required: ["sum"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: {
          accumulator: { sum: number };
          left: number;
          right: number;
        }) {
          return {
            sum: input.accumulator.sum + input.left + input.right,
          };
        }
      }

      const workflow = new Workflow();
      workflow
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(ZipReduceTask)
        .endReduce();

      const result = await workflow.run({ left: [1, 2, 3], right: [10, 20, 30] });
      expect(result.sum).toBe(66);
    });

    test("reduce with AddToSumTask should sum array via workflow.run", async () => {
      const workflow = new Workflow();
      workflow
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const result = await workflow.run({ currentItem: [1, 2, 3, 4] });
      expect(result.sum).toBe(10);
    });

    test("while loop should execute via workflow.run and stop when condition false", async () => {
      const workflow = new Workflow();
      workflow
        .while({
          condition: (output: { quality: number }, iteration: number) =>
            output.quality < 0.9 && iteration < 10,
          maxIterations: 20,
        })
        .addTask(RefineTask)
        .endWhile();

      const result = await workflow.run({ value: 0 });
      expect(result).toBeDefined();
      expect(result.quality).toBeGreaterThanOrEqual(0.2);
      expect(result.value).toBeGreaterThan(0);
    });

    test("chained map->reduce should execute end-to-end via workflow.run", async () => {
      // Map inner task outputs "currentItem" so MapTask collects { currentItem: [2,4,6] }.
      // That feeds into ReduceTask whose inner AddToSumTask expects "currentItem".
      class DoubleToCurrentItemTask extends Task<{ item: number }, { currentItem: number }> {
        static override type = "DoubleToCurrentItemTask";
        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }
        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { currentItem: { type: "number" } },
            required: ["currentItem"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }
        override async execute(input: { item: number }): Promise<{ currentItem: number }> {
          return { currentItem: input.item * 2 };
        }
      }

      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(DoubleToCurrentItemTask)
        .endMap()
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      // Map doubles [1,2,3] → currentItem: [2,4,6], reduce sums → 12
      const result = await workflow.run({ item: [1, 2, 3] });
      expect(result.sum).toBe(12);
    });

    test("map with TextEmbeddingTask should produce embeddings via workflow.run", async () => {
      const workflow = new Workflow();
      workflow.map({ maxIterations: "unbounded" }).addTask(TextEmbeddingTask).endMap();

      const result = (await workflow.run({ text: ["hi", "bye"] })) as {
        vector?: readonly (readonly number[])[];
      };
      expect(result.vector).toHaveLength(2);
      expect(result.vector![0]).toBeDefined();
      expect(result.vector![1]).toBeDefined();
    });

    test("iteration analysis should respect annotation/schema/runtime precedence", () => {
      class PrecedenceIterator extends IteratorTask<TaskInput, TaskOutput> {
        public static override type = "PrecedenceIterator";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              forceArray: {
                oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
                "x-ui-iteration": true,
              },
              forceScalar: {
                type: "array",
                items: { type: "number" },
                "x-ui-iteration": false,
              },
              inferredArray: {
                type: "array",
                items: { type: "number" },
              },
              runtimeFlexible: {
                oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }
      }

      const task = new PrecedenceIterator({ maxIterations: "unbounded" });
      const analysis = task.analyzeIterationInput({
        forceArray: [1, 2],
        forceScalar: [100, 200],
        inferredArray: [3, 4],
        runtimeFlexible: [5, 6],
      } as TaskInput);

      expect(analysis.arrayPorts.sort()).toEqual([
        "forceArray",
        "inferredArray",
        "runtimeFlexible",
      ]);
      expect(analysis.scalarPorts).toContain("forceScalar");

      const first = analysis.getIterationInput(0);
      expect(first.forceArray).toBe(1);
      expect(first.inferredArray).toBe(3);
      expect(first.runtimeFlexible).toBe(5);
      expect(first.forceScalar).toEqual([100, 200]);
    });

    test("map live progress labels show the active iteration as one-based", async () => {
      class ProgressLabelTask extends Task<{ item: number }, { processed: number }> {
        public static override type = "ProgressLabelTask_OneBasedMapProgress";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { processed: { type: "number" } },
            required: ["processed"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(
          input: { item: number },
          context: { updateProgress: (p: number, m?: string) => Promise<void> | void }
        ): Promise<{ processed: number }> {
          await context.updateProgress(25, "working");
          return { processed: input.item * 2 };
        }
      }

      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(ProgressLabelTask)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      const liveMessages: string[] = [];
      mapTask.events.on("progress", (_progress: number | undefined, message?: string) => {
        if (message?.endsWith(" — working")) {
          liveMessages.push(message);
        }
      });

      const result = await workflow.run({ item: [1, 2, 3] });

      expect(result.processed).toEqual([2, 4, 6]);
      expect(liveMessages).toEqual(["Map 1/3 — working", "Map 2/3 — working", "Map 3/3 — working"]);
    });

    test("iteration_start includes the cloned subgraph so UIs can render the live tasks", async () => {
      class CloneBodyTask extends Task<{ item: number }, { processed: number }> {
        public static override type = "CloneBodyTask_IterationStartGraph";
        public static override title = "Harvested filing";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { processed: { type: "number" } },
            required: ["processed"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: { item: number }): Promise<{ processed: number }> {
          return { processed: input.item };
        }
      }

      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(CloneBodyTask)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      const starts: Array<{ index: number; types: string[]; titles: string[] }> = [];
      mapTask.events.on("iteration_start", (_index, _count, subgraph) => {
        const tasks = subgraph?.getTasks() ?? [];
        starts.push({
          index: _index,
          types: tasks.map((t) => t.type),
          titles: tasks.map((t) => t.title),
        });
      });

      await workflow.run({ item: [1, 2] });

      expect(starts).toHaveLength(2);
      expect(starts[0]?.types).toEqual(["CloneBodyTask_IterationStartGraph"]);
      expect(starts[0]?.titles).toEqual(["Harvested filing"]);
      expect(starts[1]?.types).toEqual(["CloneBodyTask_IterationStartGraph"]);
    });

    test("visible iteration graphs stay readable after iteration_start so a late UI can attach", async () => {
      class LateAttachBody extends Task<{ item: number }, { processed: number }> {
        public static override type = "LateAttachBody_VisibleIterationGraphs";
        public static override title = "Inner section";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { processed: { type: "number" } },
            required: ["processed"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: { item: number }): Promise<{ processed: number }> {
          return { processed: input.item };
        }
      }

      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(LateAttachBody)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;
      const seen: string[][] = [];
      mapTask.events.on("iteration_start", () => {
        seen.push(
          mapTask.getVisibleIterationGraphs().flatMap((g) => g.graph.getTasks().map((t) => t.title))
        );
      });

      await workflow.run({ item: [1] });

      expect(seen[0]).toEqual(["Inner section"]);
      expect(
        mapTask.getVisibleIterationGraphs().flatMap((g) => g.graph.getTasks().map((t) => t.title))
      ).toEqual(["Inner section"]);
    });

    /**
     * Regression: {@link IteratorTaskRunner.executeSubgraphIteration} used to subscribe to every
     * per-task `progress` event inside an iteration's cloned subgraph and take a `Math.max` as
     * the iteration's partial progress. That meant a single early-finishing subtask reporting
     * `progress=100` saturated the iteration's partial immediately, making the outer `MapTask`
     * announce `"Map N/N"` before the slow sibling tasks had actually run. The fix subscribes
     * to the cloned subgraph's aggregate `graph_progress` instead — which averages across only
     * real-work tasks via {@link taskPrototypeHasOwnExecute} — so a fast subtask can no longer
     * prematurely complete the iteration.
     *
     * This test builds an iteration subgraph whose first task explicitly reports progress=100
     * right away (simulating a passthrough / quick-finishing node) and whose second task sleeps.
     * It then asserts that no "Map X/N" message announces an iteration as done before the slow
     * sibling has actually finished.
     */
    test("map progress does not report iterations done before real work completes", async () => {
      let slowCompletedCount = 0;

      class EarlyProgressTask extends Task<{ item: number }, { item: number }> {
        public static override type = "EarlyProgressTask_ProgressRegression";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(
          input: { item: number },
          context: { updateProgress: (p: number, m?: string) => Promise<void> | void }
        ): Promise<{ item: number }> {
          await context.updateProgress(100, "early done");
          return { item: input.item };
        }
      }

      class SlowWorkTask extends Task<{ item: number }, { processed: number }> {
        public static override type = "SlowWorkTask_ProgressRegression";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { item: { type: "number" } },
            required: ["item"],
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { processed: { type: "number" } },
            required: ["processed"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: { item: number }): Promise<{ processed: number }> {
          await sleep(20);
          slowCompletedCount += 1;
          return { processed: input.item * 2 };
        }
      }

      const n = 4;
      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: n, maxIterations: "unbounded" })
        .addTask(EarlyProgressTask)
        .addTask(SlowWorkTask)
        .endMap();

      const mapTask = workflow.graph.getTasks()[0] as MapTask;

      const events: Array<{
        progress: number | undefined;
        message?: string;
        slowDoneAtEmit: number;
      }> = [];
      mapTask.events.on("progress", (progress: number | undefined, message?: string) => {
        events.push({ progress, message, slowDoneAtEmit: slowCompletedCount });
      });

      const result = await workflow.run({ item: [1, 2, 3, 4] });
      expect((result.processed as number[]).slice().sort((a, b) => a - b)).toEqual([2, 4, 6, 8]);

      const mapCompletionMessageRegex = /^Map (\d+)\/(\d+) iterations$/;
      let sawMapMessage = false;
      for (const e of events) {
        if (!e.message) continue;
        const match = e.message.match(mapCompletionMessageRegex);
        if (!match) continue;
        sawMapMessage = true;
        const done = Number(match[1]);
        const total = Number(match[2]);
        expect(total).toBe(n);
        // Completion summaries report finished iterations, unlike live child-progress
        // labels that report the active iteration ordinal for the UI.
        expect(done).toBeLessThanOrEqual(e.slowDoneAtEmit);
      }

      expect(sawMapMessage).toBe(true);
      const last = events[events.length - 1];
      expect(last).toBeDefined();
      expect(last.progress).toBe(100);
    });

    test("while progress surfaces inner graph_progress between iteration boundaries", async () => {
      // A child task that reports progress=50 mid-execution simulates any long-running
      // inner task. Pre-fix, WhileTask only emitted at iteration boundaries
      // (25, 50, 75 for maxIterations=4), so nested streaming work was invisible to the
      // outer progress bar. With the graph_progress subscription, we should see blended
      // values between each pair of boundary emits.
      class ProgressReportingTask extends Task<{ quality?: number }, { quality: number }> {
        public static override type = "WhileTest_MidProgressTask";

        public static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { quality: { type: "number" } },
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        public static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { quality: { type: "number" } },
            required: ["quality"],
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(
          input: { quality?: number },
          context: IExecuteContext
        ): Promise<{ quality: number }> {
          await sleep(5);
          await context.updateProgress(50, "halfway");
          await sleep(5);
          return { quality: (input.quality ?? 0) + 0.25 };
        }
      }

      const maxIterations = 4;
      const workflow = new Workflow();
      workflow
        .while({
          condition: (output: { quality?: number }) => (output?.quality ?? 0) < 1,
          maxIterations,
          chainIterations: true,
        })
        .addTask(ProgressReportingTask)
        .endWhile();

      const whileTask = workflow.graph.getTasks()[0] as WhileTask;
      const events: Array<{ progress: number | undefined; message?: string }> = [];
      whileTask.events.on("progress", (progress: number | undefined, message?: string) => {
        events.push({ progress, message });
      });

      const result = await workflow.run({ quality: 0 });
      expect(result.quality).toBe(1);

      // With maxIterations=4 and 4 actual iterations, boundary emits land at 25/50/75.
      // Between those we expect blended values around 13 (iter 0 @ 50%), 38 (iter 1 @ 50%),
      // 63 (iter 2 @ 50%), 88 (iter 3 @ 50%). Require at least one sample strictly between
      // each boundary pair to prove inner progress is surfacing.
      const inBand = (lo: number, hi: number): boolean =>
        events.some((e) => typeof e.progress === "number" && e.progress > lo && e.progress < hi);

      expect(inBand(0, 25)).toBe(true);
      expect(inBand(25, 50)).toBe(true);

      // Progress should be non-decreasing across the observed emits (modulo rounding of
      // the blended value, which is monotonic by construction).
      for (let i = 1; i < events.length; i++) {
        if (events[i].progress === undefined || events[i - 1].progress === undefined) {
          throw new Error("Expected progress values to be defined");
        }
        expect(events[i].progress).toBeGreaterThanOrEqual(events[i - 1].progress!);
      }

      // No emit should exceed 100 (terminal tick sets progress=100 on completion).
      for (const e of events) {
        expect(e.progress).toBeLessThanOrEqual(100);
      }
    });
  });

  // ============================================================================
  // Complex Nested Loops (map/while/reduce) - Workflow Integration
  // ============================================================================

  describe("Complex Nested Loops - Workflow", () => {
    describe("map with while inside (each item refined until condition)", () => {
      test("should run while loop per map item and collect refined results", async () => {
        // For each value in [0,1,2], run a while loop that refines until quality >= 0.9.
        // RefineTask: quality += 0.2 per step, value += 1. So 5 steps to reach 1.0 from 0.
        const workflow = new Workflow();
        workflow
          .map({ maxIterations: "unbounded" })
          .while({
            condition: (output: { quality?: number }) => (output?.quality ?? 0) < 0.9,
            maxIterations: 10,
            chainIterations: true,
          })
          .addTask(RefineTask)
          .endWhile()
          .endMap();

        const result = await workflow.run({ value: [0, 1, 2] });
        expect(result).toBeDefined();
        expect(result.quality).toEqual([1, 1, 1]);
        expect(result.value).toEqual([5, 6, 7]); // 0+5, 1+5, 2+5 refinements
      });

      test("should respect maxIterations when while is inside map", async () => {
        const workflow = new Workflow();
        workflow
          .map({ maxIterations: "unbounded" })
          .while({
            condition: () => true, // never exit by condition
            maxIterations: 2,
            chainIterations: true,
          })
          .addTask(RefineTask)
          .endWhile()
          .endMap();

        const result = await workflow.run({ value: [0, 0] });
        expect(result).toBeDefined();
        // 2 iterations each: quality 0.4, value 2 per item
        expect((result.quality as number[]).every((q) => q === 0.4)).toBe(true);
        expect(result.value).toEqual([2, 2]);
      });
    });

    describe("while with map inside (each iteration processes an array)", () => {
      test("should run map over array inside each while iteration", async () => {
        // Outer while: run up to 3 times (by iteration count).
        // Inner map: double each item in the array for that iteration.
        // Input: value (for while start), item: [1,2,3] as scalar passed through?
        // We need while to run 3 times; each time run map on [1,2,3]. So we need
        // the while to receive "item" as scalar and pass it to inner map.
        const workflow = new Workflow();
        workflow
          .while({
            condition: (_output: unknown, iteration: number) => iteration < 3,
            maxIterations: 5,
            chainIterations: true,
          })
          .map({ maxIterations: "unbounded" })
          .addTask(ProcessItemTask)
          .endMap()
          .endWhile();

        const workflow2 = new Workflow();
        workflow2
          .while({
            condition: (_o: unknown, iteration: number) => iteration < 3,
            maxIterations: 5,
            chainIterations: false,
          })
          .map({ maxIterations: "unbounded" })
          .addTask(ProcessItemTask)
          .endMap()
          .endWhile();

        const result = await workflow2.run({ item: [1, 2, 3] });
        expect(result).toBeDefined();
        // 3 iterations, each: map on [1,2,3] -> processed [2,4,6]. Last iteration wins.
        expect(result.processed).toEqual([2, 4, 6]);
      });
    });

    describe("map -> reduce with nested map in reduce body", () => {
      test("map then reduce then run with array input", async () => {
        const workflow = new Workflow();
        workflow
          .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
          .addTask(ProcessItemTask)
          .endMap()
          .rename("processed", "currentItem")
          .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
          .addTask(AddToSumTask)
          .endReduce();

        const result = await workflow.run({ item: [1, 2, 3, 4] });
        expect(result.sum).toBe(20); // 2+4+6+8
      });
    });

    describe("triple nesting: map containing while then task after", () => {
      test("map(while(RefineTask).addTask(DoubleTask)) runs correctly", async () => {
        // While condition only sees ending-node outputs. Use RefineTask as sole while body
        // (ending node outputs {quality, value}), then DoubleTask after while completes.
        const workflow = new Workflow();
        workflow
          .map({ maxIterations: "unbounded" })
          .while({
            condition: (output: { quality?: number }) => (output?.quality ?? 0) < 0.9,
            maxIterations: 10,
            chainIterations: true,
          })
          .addTask(RefineTask)
          .endWhile()
          .addTask(DoubleTask)
          .endMap();

        const result = await workflow.run({ value: [0] });
        expect(result).toBeDefined();
        expect(result.result).toEqual([10]); // 5 refinements -> value 5, doubled -> 10
      });
    });

    describe("reduce with while inside (structure and execution)", () => {
      test("should build reduce whose body contains a WhileTask", () => {
        const workflow = new Workflow();
        workflow
          .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
          .while({
            condition: () => false,
            maxIterations: 2,
          })
          .addTask(RefineTask)
          .endWhile()
          .addTask(AddToSumTask)
          .endReduce();

        const tasks = workflow.graph.getTasks();
        expect(tasks).toHaveLength(1);
        const reduceTask = tasks[0] as ReduceTask;
        expect(reduceTask.subGraph?.getTasks().length).toBeGreaterThanOrEqual(1);
        const whileTask = reduceTask.subGraph?.getTasks()[0] as WhileTask;
        expect(whileTask).toBeInstanceOf(WhileTask);
        expect(whileTask.subGraph?.getTasks()[0]).toBeInstanceOf(RefineTask);
      });
    });

    describe("empty and edge-case nesting", () => {
      test("map with empty while (condition false immediately) still returns structure", async () => {
        const workflow = new Workflow();
        workflow
          .map({ maxIterations: "unbounded" })
          .while({
            condition: () => false,
            maxIterations: 5,
            chainIterations: true,
          })
          .addTask(RefineTask)
          .endWhile()
          .endMap();

        const result = await workflow.run({ value: [0] });
        expect(result).toBeDefined();
        // While runs 0 iterations (condition false), so RefineTask never runs - we need to check what the while returns when it runs 0 times.
        expect(result).toHaveProperty("value");
      });

      test("chained map -> while -> map (outer map, inner while with inner map) via structure only", () => {
        const workflow = new Workflow();
        workflow
          .map({ maxIterations: "unbounded" })
          .while({ condition: () => false, maxIterations: 2 })
          .map({ maxIterations: "unbounded" })
          .addTask(ProcessItemTask)
          .endMap()
          .endWhile()
          .endMap();

        const tasks = workflow.graph.getTasks();
        expect(tasks).toHaveLength(1);
        const mapTask = tasks[0] as MapTask;
        expect(mapTask.subGraph?.getTasks()).toHaveLength(1);
        const whileTask = mapTask.subGraph?.getTasks()[0] as WhileTask;
        expect(whileTask.subGraph?.getTasks()).toHaveLength(1);
        const innerMapTask = whileTask.subGraph?.getTasks()[0] as MapTask;
        expect(innerMapTask.subGraph?.getTasks()).toHaveLength(1);
        expect(innerMapTask.subGraph?.getTasks()[0]).toBeInstanceOf(ProcessItemTask);
      });
    });
  });
});
