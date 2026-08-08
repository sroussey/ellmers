/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  JsonTaskItem,
  TaskConfig,
  TaskDeserializationOptions,
  TaskGraphItemJson,
  TaskGraphJson,
} from "@workglow/task-graph";
import {
  ConditionalTask,
  createGraphFromDependencyJSON,
  createGraphFromGraphJSON,
  createTaskFromGraphJSON,
  Dataflow,
  GraphAsTask,
  Task,
  TASK_CONSTRUCTORS,
  TaskGraph,
  TaskJSONError,
  TaskRegistry,
  TaskSerializationError,
  WhileTask,
} from "@workglow/task-graph";
import { LambdaTask } from "@workglow/tasks";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DoubleToResultTask,
  TestGraphAsTask,
  TestTaskWithDefaults,
} from "@workglow/task-graph/test";
import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

// Register test tasks in the global registry (needed for toJSON serialization)
TaskRegistry.registerTask(DoubleToResultTask);
TaskRegistry.registerTask(TestTaskWithDefaults);
TaskRegistry.registerTask(TestGraphAsTask);

/**
 * Creates an isolated ServiceRegistry with only the specified task constructors.
 * Used to verify that JSON deserialization uses the passed registry, not the global one.
 */
function createTestRegistry(
  tasks: Array<{ type: string; new (...args: any[]): any }>
): ServiceRegistry {
  const container = new Container();
  const registry = new ServiceRegistry(container);
  const constructors = new Map<string, any>();
  for (const task of tasks) {
    constructors.set(task.type, task);
  }
  registry.registerInstance(TASK_CONSTRUCTORS, constructors);
  return registry;
}

describe("TaskJSON", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  let registry: ServiceRegistry;
  let savedGlobalConstructors: Map<string, any>;

  beforeEach(() => {
    // Create an isolated registry with test tasks
    registry = createTestRegistry([DoubleToResultTask, TestTaskWithDefaults, TestGraphAsTask]);
    // Save and blank the global task constructors to ensure tests use the local registry
    savedGlobalConstructors = new Map(TaskRegistry.all);
    TaskRegistry.all.clear();
  });

  afterEach(() => {
    // Restore global task constructors
    for (const [key, value] of savedGlobalConstructors) {
      TaskRegistry.all.set(key, value);
    }
  });
  describe("Task.toJSON()", () => {
    test("should serialize a simple task to JSON", () => {
      const task = new DoubleToResultTask({
        id: "task1",
        title: "My Task",
        defaults: { value: 42 },
      });
      const json = task.toJSON();

      expect(json.id).toBe("task1");
      expect(json.type).toBe("DoubleToResultTask");
      expect(json.config?.title).toBe("My Task");
      expect(json.defaults).toEqual({ value: 42 });
      expect(json.config?.extras).toBeUndefined();
    });

    test("should serialize task with defaults", () => {
      const task = new TestTaskWithDefaults({
        id: "task2",
        defaults: { value: 10, multiplier: 5 },
      });
      const json = task.toJSON();

      expect(json.defaults).toEqual({ value: 10, multiplier: 5 });
    });

    test("should omit config when there is nothing to serialize beyond id", () => {
      const task = new TestTaskWithDefaults({
        id: "task-no-config",
        defaults: { value: 10, multiplier: 5 },
      });
      const json = task.toJSON();

      expect(json.config).toBeUndefined();
    });

    test("should serialize task with extras", () => {
      const task = new DoubleToResultTask({
        id: "task3",
        extras: { metadata: { key: "value" } },
        defaults: { value: 100 },
      });
      const json = task.toJSON();

      expect(json.config?.extras).toEqual({ metadata: { key: "value" } });
    });
  });

  describe("TaskGraph.toJSON()", () => {
    test("should serialize a task graph to JSON", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      const task2 = new DoubleToResultTask({ id: "task2", defaults: { value: 20 } });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = graph.toJSON();

      expect(json.tasks).toHaveLength(2);
      expect(json.dataflows).toHaveLength(1);
      expect(json.tasks[0].id).toBe("task1");
      expect(json.tasks[1].id).toBe("task2");
      expect(json.dataflows[0]).toEqual({
        sourceTaskId: "task1",
        sourceTaskPortId: "result",
        targetTaskId: "task2",
        targetTaskPortId: "value",
      });
    });

    test("should serialize graph with multiple dataflows", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      const task2 = new DoubleToResultTask({ id: "task2", defaults: { value: 20 } });
      const task3 = new DoubleToResultTask({ id: "task3", defaults: { value: 30 } });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addTask(task3);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));
      graph.addDataflow(new Dataflow("task1", "result", "task3", "value"));

      const json = graph.toJSON();

      expect(json.tasks).toHaveLength(3);
      expect(json.dataflows).toHaveLength(2);
    });
  });

  describe("createTaskFromGraphJSON()", () => {
    test("should create a task from JSON", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 42 },
        config: { title: "My Task" },
      };

      const task = createTaskFromGraphJSON(json, registry);

      expect(task.id).toBe("task1");
      expect(task.type).toBe("DoubleToResultTask");
      expect(task.config.title).toBe("My Task");
      expect(task.defaults).toEqual({ value: 42 });
    });

    test("should create a task with defaults", () => {
      const json: TaskGraphItemJson = {
        id: "task2",
        type: "TestTaskWithDefaults",
        defaults: { value: 10, multiplier: 5 },
        config: {},
      };

      const task = createTaskFromGraphJSON(json, registry);

      expect(task.defaults).toEqual({ value: 10, multiplier: 5 });
    });

    test("should create a task with extras", () => {
      const json: TaskGraphItemJson = {
        id: "task3",
        type: "DoubleToResultTask",
        defaults: { value: 100 },
        config: { extras: { metadata: { key: "value" } } },
      };

      const task = createTaskFromGraphJSON(json, registry);

      expect(task.config.extras).toEqual({ metadata: { key: "value" } });
    });

    test("should throw error if task type is not found", () => {
      const json: TaskGraphItemJson = {
        id: "task4",
        type: "NonExistentTask",
        defaults: { value: 10 },
        config: {},
      };

      expect(() => createTaskFromGraphJSON(json, registry)).toThrow(
        "Task type NonExistentTask not found"
      );
    });

    test("should throw error if id is missing", () => {
      const json = {
        type: "DoubleToResultTask",
        defaults: { value: 10 },
      } as unknown as TaskGraphItemJson;

      expect(() => createTaskFromGraphJSON(json, registry)).toThrow("Task id required");
    });

    test("should throw error if type is missing", () => {
      const json = {
        id: "task5",
        defaults: { value: 10 },
      } as unknown as TaskGraphItemJson;

      expect(() => createTaskFromGraphJSON(json, registry)).toThrow("Task type required");
    });

    test("should fail without registry when global constructors are cleared", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 42 },
        config: {},
      };

      // Without passing registry, it falls back to global TaskRegistry which is cleared
      expect(() => createTaskFromGraphJSON(json)).toThrow("Task type DoubleToResultTask not found");
    });
  });

  describe("createGraphFromGraphJSON()", () => {
    test("should create a task graph from JSON", () => {
      const json: TaskGraphJson = {
        tasks: [
          {
            id: "task1",
            type: "DoubleToResultTask",
            defaults: { value: 10 },
            config: {},
          },
          {
            id: "task2",
            type: "DoubleToResultTask",
            defaults: { value: 20 },
            config: {},
          },
        ],
        dataflows: [
          {
            sourceTaskId: "task1",
            sourceTaskPortId: "result",
            targetTaskId: "task2",
            targetTaskPortId: "value",
          },
        ],
      };

      const graph = createGraphFromGraphJSON(json, registry);

      const tasks = graph.getTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe("task1");
      expect(tasks[1].id).toBe("task2");

      const dataflows = graph.getDataflows();
      expect(dataflows).toHaveLength(1);
      expect(dataflows[0].sourceTaskId).toBe("task1");
      expect(dataflows[0].targetTaskId).toBe("task2");
    });

    test("should create graph with nested subgraph", () => {
      const json: TaskGraphJson = {
        tasks: [
          {
            id: "parent",
            type: "TestGraphAsTask",
            defaults: { input: "test" },
            config: {},
            subgraph: {
              tasks: [
                {
                  id: "child1",
                  type: "DoubleToResultTask",
                  defaults: { value: 5 },
                  config: {},
                },
                {
                  id: "child2",
                  type: "DoubleToResultTask",
                  defaults: { value: 10 },
                  config: {},
                },
              ],
              dataflows: [],
            },
          },
        ],
        dataflows: [],
      };

      const graph = createGraphFromGraphJSON(json, registry);

      const tasks = graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("parent");
      expect(tasks[0]).toBeInstanceOf(GraphAsTask);

      const graphAsTask = tasks[0] as GraphAsTask<any, any>;
      expect(graphAsTask.subGraph).toBeDefined();
      const subTasks = graphAsTask.subGraph!.getTasks();
      expect(subTasks).toHaveLength(2);
    });
  });

  describe("createGraphFromDependencyJSON()", () => {
    test("wires top-level dependencies into dataflows", () => {
      const items: JsonTaskItem[] = [
        { id: "task1", type: "DoubleToResultTask", defaults: { value: 10 } },
        {
          id: "task2",
          type: "DoubleToResultTask",
          dependencies: { value: { id: "task1", output: "result" } },
        },
      ];

      const graph = createGraphFromDependencyJSON(items, registry);

      const dataflows = graph.getDataflows();
      expect(dataflows).toHaveLength(1);
      expect(dataflows[0].sourceTaskId).toBe("task1");
      expect(dataflows[0].targetTaskId).toBe("task2");
    });

    test("wires dependencies inside recursed subtasks", () => {
      const items: JsonTaskItem[] = [
        {
          id: "parent",
          type: "TestGraphAsTask",
          subtasks: [
            { id: "child1", type: "DoubleToResultTask", defaults: { value: 5 } },
            {
              id: "child2",
              type: "DoubleToResultTask",
              dependencies: { value: { id: "child1", output: "result" } },
            },
          ],
        },
      ];

      const graph = createGraphFromDependencyJSON(items, registry);

      const parent = graph.getTasks()[0] as GraphAsTask<any, any>;
      const subDataflows = parent.subGraph!.getDataflows();
      expect(subDataflows).toHaveLength(1);
      expect(subDataflows[0].sourceTaskId).toBe("child1");
      expect(subDataflows[0].targetTaskId).toBe("child2");
    });

    test("throws for a nested dependency id outside its own subgraph", () => {
      const items: JsonTaskItem[] = [
        { id: "outside", type: "DoubleToResultTask", defaults: { value: 1 } },
        {
          id: "parent",
          type: "TestGraphAsTask",
          subtasks: [
            {
              id: "child",
              type: "DoubleToResultTask",
              dependencies: { value: { id: "outside", output: "result" } },
            },
          ],
        },
      ];

      expect(() => createGraphFromDependencyJSON(items, registry)).toThrow(
        "Dependency id outside not found"
      );
    });

    test("round-trips subgraph dataflows via toDependencyJSON", () => {
      const originalGraph = new TaskGraph();
      const parentTask = new TestGraphAsTask({ id: "parent", defaults: { input: "test" } });
      const childGraph = new TaskGraph();
      childGraph.addTask(new DoubleToResultTask({ id: "child1", defaults: { value: 5 } }));
      childGraph.addTask(new DoubleToResultTask({ id: "child2", defaults: { value: 10 } }));
      childGraph.addDataflow(new Dataflow("child1", "result", "child2", "value"));
      parentTask.subGraph = childGraph;
      originalGraph.addTask(parentTask);

      const items = originalGraph.toDependencyJSON();
      const restoredGraph = createGraphFromDependencyJSON(items, registry);

      const restoredParent = restoredGraph.getTasks()[0] as GraphAsTask<any, any>;
      const restoredDataflows = restoredParent.subGraph!.getDataflows();
      expect(restoredDataflows).toHaveLength(1);
      expect(restoredDataflows[0].sourceTaskId).toBe("child1");
      expect(restoredDataflows[0].targetTaskId).toBe("child2");
    });
  });

  describe("Round-trip serialization", () => {
    test("should round-trip a simple task graph", () => {
      const originalGraph = new TaskGraph();
      const task1 = new DoubleToResultTask({
        id: "task1",
        title: "Task 1",
        defaults: { value: 10 },
      });
      const task2 = new DoubleToResultTask({
        id: "task2",
        title: "Task 2",
        defaults: { value: 20 },
      });
      originalGraph.addTask(task1);
      originalGraph.addTask(task2);
      originalGraph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json, registry);

      const originalTasks = originalGraph.getTasks();
      const restoredTasks = restoredGraph.getTasks();

      expect(restoredTasks).toHaveLength(originalTasks.length);
      expect(restoredTasks[0].id).toBe(originalTasks[0].id);
      expect(restoredTasks[0].type).toBe(originalTasks[0].type);
      expect(restoredTasks[0].config.title).toBe(originalTasks[0].config.title);
      expect(restoredTasks[0].defaults).toEqual(originalTasks[0].defaults);

      const originalDataflows = originalGraph.getDataflows();
      const restoredDataflows = restoredGraph.getDataflows();

      expect(restoredDataflows).toHaveLength(originalDataflows.length);
      expect(restoredDataflows[0].sourceTaskId).toBe(originalDataflows[0].sourceTaskId);
      expect(restoredDataflows[0].targetTaskId).toBe(originalDataflows[0].targetTaskId);
    });

    test("should round-trip a task graph with defaults and extras", () => {
      const originalGraph = new TaskGraph();
      const task1 = new TestTaskWithDefaults({
        id: "task1",
        title: "Task with Defaults",
        extras: { metadata: { key: "value" } },
        defaults: { value: 10, multiplier: 3 },
      });
      originalGraph.addTask(task1);

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json, registry);

      const restoredTask = restoredGraph.getTasks()[0];
      expect(restoredTask.defaults).toEqual({ value: 10, multiplier: 3 });
      expect(restoredTask.config.extras).toEqual({ metadata: { key: "value" } });
    });

    test("should round-trip a graph with nested subgraph", () => {
      const originalGraph = new TaskGraph();
      const parentTask = new TestGraphAsTask({ id: "parent", defaults: { input: "test" } });
      const childGraph = new TaskGraph();
      const child1 = new DoubleToResultTask({ id: "child1", defaults: { value: 5 } });
      const child2 = new DoubleToResultTask({ id: "child2", defaults: { value: 10 } });
      childGraph.addTask(child1);
      childGraph.addTask(child2);
      parentTask.subGraph = childGraph;
      originalGraph.addTask(parentTask);

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json, registry);

      const restoredParent = restoredGraph.getTasks()[0] as GraphAsTask<any, any>;
      expect(restoredParent.subGraph).toBeDefined();
      const restoredChildren = restoredParent.subGraph!.getTasks();
      expect(restoredChildren).toHaveLength(2);
      expect(restoredChildren[0].id).toBe("child1");
      expect(restoredChildren[1].id).toBe("child2");
    });
  });

  describe("TaskDeserializationOptions.allowedTypes", () => {
    test("should instantiate a task when its type is in the allowedTypes set", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 42 },
        config: {},
      };
      const options: TaskDeserializationOptions = {
        allowedTypes: new Set(["DoubleToResultTask"]),
      };

      const task = createTaskFromGraphJSON(json, registry, options);
      expect(task.id).toBe("task1");
      expect(task.type).toBe("DoubleToResultTask");
    });

    test("should instantiate a task when its type is in an array allowedTypes list", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 10 },
        config: {},
      };
      const options: TaskDeserializationOptions = {
        allowedTypes: ["DoubleToResultTask", "TestTaskWithDefaults"],
      };

      const task = createTaskFromGraphJSON(json, registry, options);
      expect(task.type).toBe("DoubleToResultTask");
    });

    test("should throw TaskJSONError when type is not in the allowedTypes set", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 42 },
        config: {},
      };
      const options: TaskDeserializationOptions = {
        allowedTypes: new Set(["TestTaskWithDefaults"]), // DoubleToResultTask is NOT allowed
      };

      expect(() => createTaskFromGraphJSON(json, registry, options)).toThrow(TaskJSONError);
      expect(() => createTaskFromGraphJSON(json, registry, options)).toThrow(
        '"DoubleToResultTask" is not in the allowed types list'
      );
    });

    test("should throw TaskJSONError for a disallowed type in an array allowlist", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: {},
        config: {},
      };
      const options: TaskDeserializationOptions = {
        allowedTypes: ["TestTaskWithDefaults"],
      };

      expect(() => createTaskFromGraphJSON(json, registry, options)).toThrow(TaskJSONError);
    });

    test("should allow all types when allowedTypes is not provided", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 99 },
        config: {},
      };

      const task = createTaskFromGraphJSON(json, registry);
      expect(task.type).toBe("DoubleToResultTask");
    });

    test("should propagate allowedTypes to nested subgraph tasks", () => {
      const json: TaskGraphItemJson = {
        id: "parent",
        type: "TestGraphAsTask",
        defaults: { input: "test" },
        config: {},
        subgraph: {
          tasks: [
            {
              id: "child1",
              type: "DoubleToResultTask",
              defaults: { value: 5 },
              config: {},
            },
          ],
          dataflows: [],
        },
      };

      // DoubleToResultTask in the subgraph should be blocked
      const options: TaskDeserializationOptions = {
        allowedTypes: new Set(["TestGraphAsTask"]), // child type NOT allowed
      };

      expect(() => createTaskFromGraphJSON(json, registry, options)).toThrow(TaskJSONError);
      expect(() => createTaskFromGraphJSON(json, registry, options)).toThrow(
        '"DoubleToResultTask" is not in the allowed types list'
      );
    });

    test("should allow nested subgraph tasks when all types are allowlisted", () => {
      const json: TaskGraphItemJson = {
        id: "parent",
        type: "TestGraphAsTask",
        defaults: { input: "test" },
        config: {},
        subgraph: {
          tasks: [
            {
              id: "child1",
              type: "DoubleToResultTask",
              defaults: { value: 5 },
              config: {},
            },
          ],
          dataflows: [],
        },
      };

      const options: TaskDeserializationOptions = {
        allowedTypes: new Set(["TestGraphAsTask", "DoubleToResultTask"]),
      };

      const task = createTaskFromGraphJSON(json, registry, options);
      expect(task.id).toBe("parent");
      const graphAsTask = task as GraphAsTask<any, any>;
      expect(graphAsTask.subGraph).toBeDefined();
      expect(graphAsTask.subGraph!.getTasks()).toHaveLength(1);
    });

    test("should propagate allowedTypes through createGraphFromGraphJSON", () => {
      const json: TaskGraphJson = {
        tasks: [
          {
            id: "task1",
            type: "DoubleToResultTask",
            defaults: { value: 10 },
            config: {},
          },
          {
            id: "task2",
            type: "TestTaskWithDefaults",
            defaults: { value: 20, multiplier: 2 },
            config: {},
          },
        ],
        dataflows: [],
      };

      // Only allow DoubleToResultTask — TestTaskWithDefaults should be rejected
      const options: TaskDeserializationOptions = {
        allowedTypes: new Set(["DoubleToResultTask"]),
      };

      expect(() => createGraphFromGraphJSON(json, registry, options)).toThrow(TaskJSONError);
      expect(() => createGraphFromGraphJSON(json, registry, options)).toThrow(
        '"TestTaskWithDefaults" is not in the allowed types list'
      );
    });
  });

  describe("canSerializeConfig and _originalConfig", () => {
    class NonSerializableTask extends Task<{ value: string }, { result: string }> {
      static override readonly type = "NonSerializableTask";
      static override readonly category = "Test";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      public override canSerializeConfig(): boolean {
        return false;
      }
      override async execute(input: { value: string }) {
        return { result: input.value };
      }
    }

    class MutableConfigTask extends Task<
      { value: string },
      { result: string },
      TaskConfig & { inputSchema?: unknown; discovered?: boolean }
    > {
      static override readonly type = "MutableConfigTask";
      static override readonly category = "Test";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { value: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      static override configSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            inputSchema: { type: "object", additionalProperties: true },
            discovered: { type: "boolean" },
          },
        } as const satisfies DataPortSchema;
      }
      override async execute(input: { value: string }) {
        // Simulate runtime config mutation (like MCP discoverSchemas)
        (this.config as Record<string, unknown>).discovered = true;
        (this.config as Record<string, unknown>).inputSchema = {
          type: "object",
          properties: { name: { type: "string" } },
        };
        return { result: input.value };
      }
    }

    test("toJSON throws TaskSerializationError when canSerializeConfig returns false", () => {
      const task = new NonSerializableTask({ id: "ns1" });
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("toJSON uses _originalConfig, not mutated this.config", async () => {
      const task = new MutableConfigTask({ id: "mc1" });
      await task.run({ value: "hello" });

      // Config was mutated at runtime
      expect((task.config as Record<string, unknown>).discovered).toBe(true);
      expect((task.config as Record<string, unknown>).inputSchema).toBeDefined();

      // But toJSON should use the original snapshot
      const json = task.toJSON();
      const jsonConfig = json.config as Record<string, unknown> | undefined;
      expect(jsonConfig?.discovered).toBeUndefined();
      expect(jsonConfig?.inputSchema).toBeUndefined();
    });

    test("canSerializeConfig returns true by default", () => {
      const task = new DoubleToResultTask({ id: "d1", defaults: { value: 1 } });
      expect(task.canSerializeConfig()).toBe(true);
    });
  });

  describe("canSerializeConfig overrides", () => {
    test("LambdaTask.canSerializeConfig always returns false", () => {
      const task = new LambdaTask({ execute: async (input: any) => input });
      expect(task.canSerializeConfig()).toBe(false);
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("WhileTask with function condition is not serializable", () => {
      const task = new WhileTask({
        condition: (_output: any, _i: number) => true,
        maxIterations: 10,
      });
      expect(task.canSerializeConfig()).toBe(false);
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("WhileTask with declarative condition is serializable", () => {
      const task = new WhileTask({
        conditionField: "done",
        conditionOperator: "equals",
        conditionValue: "false",
        maxIterations: 10,
      });
      expect(task.canSerializeConfig()).toBe(true);
      expect(() => task.toJSON()).not.toThrow();
    });

    test("ConditionalTask with function branches is not serializable", () => {
      const task = new ConditionalTask({
        branches: [{ id: "a", condition: (_input: any) => true, outputPort: "out_a" }],
      });
      expect(task.canSerializeConfig()).toBe(false);
      expect(() => task.toJSON()).toThrow(TaskSerializationError);
    });

    test("ConditionalTask with conditionConfig is serializable", () => {
      const task = new ConditionalTask({
        conditionConfig: {
          branches: [
            {
              id: "a",
              field: "x",
              operator: "equals",
              value: "1",
            },
          ],
          exclusive: true,
        },
      });
      expect(task.canSerializeConfig()).toBe(true);
      expect(() => task.toJSON()).not.toThrow();
    });
  });
});
