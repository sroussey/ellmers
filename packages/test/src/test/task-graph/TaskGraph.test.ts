/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataflow, serialGraph, TaskGraph, TaskStatus } from "@workglow/task-graph";
import { TestIOTask } from "@workglow/task-graph/test";
import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("TaskGraph", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let graph = new TaskGraph();
  let tasks: TestIOTask[];
  let registry: ServiceRegistry;

  beforeEach(() => {
    // Create an isolated registry for each test
    const container = new Container();
    registry = new ServiceRegistry(container);

    graph = new TaskGraph();
    tasks = [
      new TestIOTask({ id: "task1" }),
      new TestIOTask({ id: "task2" }),
      new TestIOTask({ id: "task3" }),
    ];
  });

  it("should add nodes to the graph", () => {
    graph.addTasks(tasks);

    expect(graph.getTask("task1")).toBeDefined();
    expect(graph.getTask("task2")).toBeDefined();
    expect(graph.getTask("task3")).toBeDefined();
  });

  it("should add edges to the graph", () => {
    const edges: Dataflow[] = [
      new Dataflow("task1", "output1", "task2", "input1"),
      new Dataflow("task2", "output2", "task3", "input2"),
    ];

    graph.addTasks(tasks);
    graph.addDataflows(edges);

    expect(graph.getDataflow("task1[output1] ==> task2[input1]")).toBeDefined();
    expect(graph.getDataflow("task2[output2] ==> task3[input2]")).toBeDefined();
  });

  it("should create a serial graph", () => {
    const inputHandle = "input";
    const outputHandle = "output";

    // A serial chain task[i] -> task[i+1] reads from the upstream task's
    // OUTPUT port and writes to the downstream task's INPUT port.
    const expectedDataflows: Dataflow[] = [
      new Dataflow("task1", outputHandle, "task2", inputHandle),
      new Dataflow("task2", outputHandle, "task3", inputHandle),
    ];

    const result = serialGraph(tasks, inputHandle, outputHandle);

    expect(result).toBeInstanceOf(TaskGraph);
    expect(result.getDataflows()).toEqual(expectedDataflows);
    expect(result.getDataflow("task1[output] ==> task2[input]")).toBeDefined();
    expect(result.getDataflow("task2[output] ==> task3[input]")).toBeDefined();
  });

  describe("subscribeToTaskStatus", () => {
    it("should subscribe to status changes on existing tasks", async () => {
      graph.addTasks(tasks);
      const statusChanges: Array<{ taskId: unknown; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToTaskStatus((taskId, status) => {
        statusChanges.push({ taskId, status });
      });

      // Run a task to trigger status changes
      const task1 = graph.getTask("task1")!;
      await task1.run({}, { registry });

      expect(statusChanges.length).toBeGreaterThan(0);
      expect(statusChanges.some((change) => change.taskId === "task1")).toBe(true);
      expect(statusChanges.some((change) => change.status === TaskStatus.COMPLETED)).toBe(true);

      unsubscribe();
    });

    it("should subscribe to status changes on newly added tasks", async () => {
      const statusChanges: Array<{ taskId: unknown; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToTaskStatus((taskId, status) => {
        statusChanges.push({ taskId, status });
      });

      // Add a task after subscribing
      const newTask = new TestIOTask({ id: "newTask" });
      graph.addTask(newTask);

      // Run the newly added task
      await newTask.run({}, { registry });

      expect(statusChanges.some((change) => change.taskId === "newTask")).toBe(true);
      expect(statusChanges.some((change) => change.status === TaskStatus.COMPLETED)).toBe(true);

      unsubscribe();
    });

    it("should handle multiple tasks status changes", async () => {
      graph.addTasks(tasks);
      const statusChanges: Array<{ taskId: unknown; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToTaskStatus((taskId, status) => {
        statusChanges.push({ taskId, status });
      });

      // Run multiple tasks via graph with explicit registry
      await graph.run({}, { registry });

      const task1Changes = statusChanges.filter((change) => change.taskId === "task1");
      const task2Changes = statusChanges.filter((change) => change.taskId === "task2");

      expect(task1Changes.length).toBeGreaterThan(0);
      expect(task2Changes.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it("should unsubscribe from all task status events", async () => {
      graph.addTasks(tasks);
      const statusChanges: Array<{ taskId: unknown; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToTaskStatus((taskId, status) => {
        statusChanges.push({ taskId, status });
      });

      // Run a task
      await graph.getTask("task1")!.run({}, { registry });
      const initialCount = statusChanges.length;

      // Unsubscribe
      unsubscribe();

      // Run another task - should not trigger callback
      await graph.getTask("task2")!.run({}, { registry });

      expect(statusChanges.length).toBe(initialCount);
    });

    it("should handle task disable status changes", async () => {
      graph.addTasks(tasks);
      const statusChanges: Array<{ taskId: unknown; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToTaskStatus((taskId, status) => {
        statusChanges.push({ taskId, status });
      });

      const task1 = graph.getTask("task1")!;
      await task1.disable();

      expect(
        statusChanges.some(
          (change) => change.taskId === "task1" && change.status === TaskStatus.DISABLED
        )
      ).toBe(true);

      unsubscribe();
    });
  });

  describe("subscribeToDataflowStatus", () => {
    it("should subscribe to status changes on existing dataflows", () => {
      graph.addTasks(tasks);
      const dataflows: Dataflow[] = [
        new Dataflow("task1", "output1", "task2", "input1"),
        new Dataflow("task2", "output2", "task3", "input2"),
      ];
      graph.addDataflows(dataflows);

      const statusChanges: Array<{ dataflowId: string; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToDataflowStatus((dataflowId, status) => {
        statusChanges.push({ dataflowId, status });
      });

      // Change status of a dataflow
      const dataflow1 = graph.getDataflow("task1[output1] ==> task2[input1]")!;
      dataflow1.setStatus(TaskStatus.PROCESSING);
      dataflow1.setStatus(TaskStatus.COMPLETED);

      expect(statusChanges.length).toBeGreaterThan(0);
      expect(
        statusChanges.some((change) => change.dataflowId === "task1[output1] ==> task2[input1]")
      ).toBe(true);
      expect(statusChanges.some((change) => change.status === TaskStatus.PROCESSING)).toBe(true);
      expect(statusChanges.some((change) => change.status === TaskStatus.COMPLETED)).toBe(true);

      unsubscribe();
    });

    it("should subscribe to status changes on newly added dataflows", () => {
      graph.addTasks(tasks);
      const statusChanges: Array<{ dataflowId: string; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToDataflowStatus((dataflowId, status) => {
        statusChanges.push({ dataflowId, status });
      });

      // Add a dataflow after subscribing
      const newDataflow = new Dataflow("task1", "output1", "task2", "input1");
      graph.addDataflow(newDataflow);

      // Change status of the newly added dataflow
      newDataflow.setStatus(TaskStatus.PROCESSING);

      expect(statusChanges.some((change) => change.dataflowId === newDataflow.id)).toBe(true);
      expect(statusChanges.some((change) => change.status === TaskStatus.PROCESSING)).toBe(true);

      unsubscribe();
    });

    it("should handle multiple dataflow status changes", () => {
      graph.addTasks(tasks);
      const dataflows: Dataflow[] = [
        new Dataflow("task1", "output1", "task2", "input1"),
        new Dataflow("task2", "output2", "task3", "input2"),
      ];
      graph.addDataflows(dataflows);

      const statusChanges: Array<{ dataflowId: string; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToDataflowStatus((dataflowId, status) => {
        statusChanges.push({ dataflowId, status });
      });

      // Change status of multiple dataflows
      const dataflow1 = graph.getDataflow("task1[output1] ==> task2[input1]")!;
      const dataflow2 = graph.getDataflow("task2[output2] ==> task3[input2]")!;

      dataflow1.setStatus(TaskStatus.PROCESSING);
      dataflow2.setStatus(TaskStatus.PROCESSING);

      const dataflow1Changes = statusChanges.filter((change) => change.dataflowId === dataflow1.id);
      const dataflow2Changes = statusChanges.filter((change) => change.dataflowId === dataflow2.id);

      expect(dataflow1Changes.length).toBeGreaterThan(0);
      expect(dataflow2Changes.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it("should unsubscribe from all dataflow status events", () => {
      graph.addTasks(tasks);
      const dataflows: Dataflow[] = [
        new Dataflow("task1", "output1", "task2", "input1"),
        new Dataflow("task2", "output2", "task3", "input2"),
      ];
      graph.addDataflows(dataflows);

      const statusChanges: Array<{ dataflowId: string; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToDataflowStatus((dataflowId, status) => {
        statusChanges.push({ dataflowId, status });
      });

      // Change status of a dataflow
      const dataflow1 = graph.getDataflow("task1[output1] ==> task2[input1]")!;
      dataflow1.setStatus(TaskStatus.PROCESSING);
      const initialCount = statusChanges.length;

      // Unsubscribe
      unsubscribe();

      // Change status of another dataflow - should not trigger callback
      const dataflow2 = graph.getDataflow("task2[output2] ==> task3[input2]")!;
      dataflow2.setStatus(TaskStatus.PROCESSING);

      expect(statusChanges.length).toBe(initialCount);
    });

    it("should handle dataflow disabled status changes", () => {
      graph.addTasks(tasks);
      const dataflow = new Dataflow("task1", "output1", "task2", "input1");
      graph.addDataflow(dataflow);

      const statusChanges: Array<{ dataflowId: string; status: TaskStatus }> = [];

      const unsubscribe = graph.subscribeToDataflowStatus((dataflowId, status) => {
        statusChanges.push({ dataflowId, status });
      });

      dataflow.setStatus(TaskStatus.DISABLED);

      expect(
        statusChanges.some(
          (change) => change.dataflowId === dataflow.id && change.status === TaskStatus.DISABLED
        )
      ).toBe(true);

      unsubscribe();
    });
  });
});
