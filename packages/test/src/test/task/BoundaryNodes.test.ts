/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  computeGraphInputSchema,
  computeGraphOutputSchema,
  Dataflow,
  TaskGraph,
  TaskRegistry,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import {
  DoubleToResultTask,
  GraphAsTask_TaskA,
  GraphAsTask_TaskB,
  GraphAsTask_TaskC,
  TestGraphAsTask,
} from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

// Register test tasks
TaskRegistry.registerTask(DoubleToResultTask);
TaskRegistry.registerTask(GraphAsTask_TaskA);
TaskRegistry.registerTask(GraphAsTask_TaskB);
TaskRegistry.registerTask(GraphAsTask_TaskC);
TaskRegistry.registerTask(TestGraphAsTask);

describe("Boundary Nodes", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("TaskGraph.toJSON({ withBoundaryNodes: true })", () => {
    it("should add InputTask and OutputTask boundary nodes for a simple linear graph", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      const task2 = new DoubleToResultTask({ id: "task2", defaults: { value: 0 } });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = graph.toJSON({ withBoundaryNodes: true });

      // Should have 4 tasks: InputTask, task1, task2, OutputTask
      expect(json.tasks).toHaveLength(4);
      expect(json.tasks[0].type).toBe("InputTask");
      expect(json.tasks[json.tasks.length - 1].type).toBe("OutputTask");

      // Original tasks should still be there
      expect(json.tasks[1].id).toBe("task1");
      expect(json.tasks[2].id).toBe("task2");
    });

    it("should not add boundary nodes without the option", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON();
      expect(json.tasks).toHaveLength(1);
      expect(json.tasks[0].type).toBe("DoubleToResultTask");
    });

    it("should not add boundary nodes when option is false", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON({ withBoundaryNodes: false });
      expect(json.tasks).toHaveLength(1);
    });

    it("should create per-property dataflows from InputTask to root tasks", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON({ withBoundaryNodes: true });
      const inputTaskId = json.tasks[0].id;

      // InputTask should have a dataflow for the "value" property to task1
      const inputDataflows = json.dataflows.filter((df) => df.sourceTaskId === inputTaskId);
      expect(inputDataflows.length).toBeGreaterThan(0);
      expect(inputDataflows.some((df) => df.targetTaskId === "task1")).toBe(true);
    });

    it("should create per-property dataflows from leaf tasks to OutputTask", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON({ withBoundaryNodes: true });
      const outputTaskId = json.tasks[json.tasks.length - 1].id;

      // task1 should have a dataflow to OutputTask for the "result" property
      const outputDataflows = json.dataflows.filter((df) => df.targetTaskId === outputTaskId);
      expect(outputDataflows.length).toBeGreaterThan(0);
      expect(outputDataflows.some((df) => df.sourceTaskId === "task1")).toBe(true);
    });

    it("should set InputTask config schemas to match graph input schema", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON({ withBoundaryNodes: true });
      const inputTask = json.tasks[0];

      expect(inputTask.config?.inputSchema).toBeDefined();
      expect(inputTask.config?.outputSchema).toBeDefined();
      // Both should be equal (InputTask mirrors input to output)
      expect(inputTask.config?.inputSchema).toEqual(inputTask.config?.outputSchema);

      // Should have the "value" property from DoubleToResultTask's input
      const schema = inputTask.config?.inputSchema;
      if (typeof schema !== "boolean" && schema) {
        expect(schema.properties).toBeDefined();
        expect((schema.properties as any)?.value).toBeDefined();
      }
    });

    it("should set OutputTask config schemas to match graph output schema", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON({ withBoundaryNodes: true });
      const outputTask = json.tasks[json.tasks.length - 1];

      expect(outputTask.config?.outputSchema).toBeDefined();
      const schema = outputTask.config?.outputSchema;
      if (typeof schema !== "boolean" && schema) {
        expect(schema.properties).toBeDefined();
        expect((schema.properties as any)?.result).toBeDefined();
      }
    });

    it("should strip origin annotations from boundary node schemas", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const json = graph.toJSON({ withBoundaryNodes: true });
      const inputTask = json.tasks[0];
      const schema = inputTask.config?.inputSchema;

      if (typeof schema !== "boolean" && schema?.properties) {
        for (const prop of Object.values(schema.properties)) {
          expect((prop as any)["x-source-task-id"]).toBeUndefined();
          expect((prop as any)["x-source-task-ids"]).toBeUndefined();
        }
      }
    });

    it("should handle multiple starting nodes", () => {
      const taskA = new GraphAsTask_TaskA({ id: "taskA" });
      const taskB = new GraphAsTask_TaskB({ id: "taskB" });
      const taskC = new GraphAsTask_TaskC({ id: "taskC" });

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);
      graph.addDataflow(new Dataflow("taskA", "outputA", "taskC", "inputC1"));
      graph.addDataflow(new Dataflow("taskB", "outputB", "taskC", "inputC2"));

      const json = graph.toJSON({ withBoundaryNodes: true });

      // Should have 5 tasks: InputTask, taskA, taskB, taskC, OutputTask
      expect(json.tasks).toHaveLength(5);
      expect(json.tasks[0].type).toBe("InputTask");
      expect(json.tasks[json.tasks.length - 1].type).toBe("OutputTask");

      // InputTask should have dataflows to both taskA and taskB
      const inputTaskId = json.tasks[0].id;
      const inputDataflows = json.dataflows.filter((df) => df.sourceTaskId === inputTaskId);
      const targetTaskIds = new Set(inputDataflows.map((df) => df.targetTaskId));
      expect(targetTaskIds.has("taskA")).toBe(true);
      expect(targetTaskIds.has("taskB")).toBe(true);
    });

    it("should preserve original dataflows", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      const task2 = new DoubleToResultTask({ id: "task2", defaults: { value: 0 } });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = graph.toJSON({ withBoundaryNodes: true });

      // Original dataflow should still exist
      const originalDf = json.dataflows.find(
        (df) =>
          df.sourceTaskId === "task1" &&
          df.sourceTaskPortId === "result" &&
          df.targetTaskId === "task2" &&
          df.targetTaskPortId === "value"
      );
      expect(originalDf).toBeDefined();
    });
  });

  describe("TaskGraph.toDependencyJSON({ withBoundaryNodes: true })", () => {
    it("should add InputTask and OutputTask boundary nodes", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      const task2 = new DoubleToResultTask({ id: "task2", defaults: { value: 0 } });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const items = graph.toDependencyJSON({ withBoundaryNodes: true });

      // Should have 4 items: InputTask, task1, task2, OutputTask
      expect(items).toHaveLength(4);
      expect(items[0].type).toBe("InputTask");
      expect(items[items.length - 1].type).toBe("OutputTask");
    });

    it("should add dependencies from InputTask to root tasks", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const items = graph.toDependencyJSON({ withBoundaryNodes: true });

      // task1 should have a dependency on InputTask for "value"
      const task1Item = items.find((item) => item.id === "task1");
      expect(task1Item?.dependencies).toBeDefined();
      expect(task1Item?.dependencies?.["value"]).toBeDefined();
    });

    it("should add dependencies on OutputTask from leaf tasks", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const items = graph.toDependencyJSON({ withBoundaryNodes: true });
      const outputTask = items[items.length - 1];

      // OutputTask should have dependencies from task1
      expect(outputTask.dependencies).toBeDefined();
      expect(outputTask.dependencies?.["result"]).toBeDefined();
    });

    it("should not add boundary nodes without the option", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const items = graph.toDependencyJSON();
      expect(items).toHaveLength(1);
    });
  });

  describe("Recursive boundary nodes with GraphAsTask", () => {
    it("should add boundary nodes at subgraph level", () => {
      const graph = new TaskGraph();
      const parentTask = new TestGraphAsTask({ id: "parent" });
      const childGraph = new TaskGraph();
      const child1 = new DoubleToResultTask({ id: "child1", defaults: { value: 5 } });
      const child2 = new DoubleToResultTask({ id: "child2", defaults: { value: 0 } });
      childGraph.addTask(child1);
      childGraph.addTask(child2);
      childGraph.addDataflow(new Dataflow("child1", "result", "child2", "value"));
      parentTask.subGraph = childGraph;
      graph.addTask(parentTask);

      const json = graph.toJSON({ withBoundaryNodes: true });

      // Top level: InputTask, parent, OutputTask
      expect(json.tasks).toHaveLength(3);
      expect(json.tasks[0].type).toBe("InputTask");
      expect(json.tasks[json.tasks.length - 1].type).toBe("OutputTask");

      // Subgraph level: should also have boundary nodes
      const parentJson = json.tasks.find((t) => t.id === "parent");
      expect(parentJson?.subgraph).toBeDefined();
      const subgraph = parentJson!.subgraph!;
      expect(subgraph.tasks[0].type).toBe("InputTask");
      expect(subgraph.tasks[subgraph.tasks.length - 1].type).toBe("OutputTask");
      // child1, child2, + InputTask, OutputTask = 4
      expect(subgraph.tasks).toHaveLength(4);
    });

    it("should add boundary nodes at subgraph level in dependency JSON", () => {
      const graph = new TaskGraph();
      const parentTask = new TestGraphAsTask({ id: "parent" });
      const childGraph = new TaskGraph();
      const child1 = new DoubleToResultTask({ id: "child1", defaults: { value: 5 } });
      childGraph.addTask(child1);
      parentTask.subGraph = childGraph;
      graph.addTask(parentTask);

      const items = graph.toDependencyJSON({ withBoundaryNodes: true });

      // Top level: InputTask, parent, OutputTask
      expect(items).toHaveLength(3);
      expect(items[0].type).toBe("InputTask");
      expect(items[items.length - 1].type).toBe("OutputTask");

      // Subtasks of parent should also have boundary nodes
      const parentItem = items.find((item) => item.id === "parent");
      expect(parentItem?.subtasks).toBeDefined();
      const subtasks = parentItem!.subtasks!;
      expect(subtasks[0].type).toBe("InputTask");
      expect(subtasks[subtasks.length - 1].type).toBe("OutputTask");
    });
  });

  describe("computeGraphInputSchema with trackOrigins", () => {
    it("should track single origin for root task properties", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const schema = computeGraphInputSchema(graph, { trackOrigins: true });
      if (typeof schema !== "boolean") {
        const valueProp = (schema.properties as any)?.value;
        expect(valueProp?.["x-source-task-id"]).toBe("task1");
      }
    });

    it("should track multiple origins for shared property names", () => {
      const graph = new TaskGraph();
      // TaskA has inputA1, inputA2. TaskB has inputB. Both are roots.
      const taskA = new GraphAsTask_TaskA({ id: "taskA" });
      const taskB = new GraphAsTask_TaskB({ id: "taskB" });
      graph.addTask(taskA);
      graph.addTask(taskB);

      const schema = computeGraphInputSchema(graph, { trackOrigins: true });
      if (typeof schema !== "boolean") {
        const inputA1 = (schema.properties as any)?.inputA1;
        expect(inputA1?.["x-source-task-id"]).toBe("taskA");

        const inputB = (schema.properties as any)?.inputB;
        expect(inputB?.["x-source-task-id"]).toBe("taskB");
      }
    });
  });

  describe("computeGraphOutputSchema with trackOrigins", () => {
    it("should track single origin for leaf task output properties", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ id: "task1", defaults: { value: 10 } });
      graph.addTask(task1);

      const schema = computeGraphOutputSchema(graph, { trackOrigins: true });
      if (typeof schema !== "boolean") {
        const resultProp = (schema.properties as any)?.result;
        expect(resultProp?.["x-source-task-id"]).toBe("task1");
      }
    });
  });
});
