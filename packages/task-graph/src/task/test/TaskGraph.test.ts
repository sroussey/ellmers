//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach } from "bun:test";
import { SingleTask, Task, TaskOutput } from "../base/Task";
import { TaskGraph, DataFlow, serialGraph } from "../base/TaskGraph";

class TestTask extends SingleTask {
  static readonly type = "TestTask";
  async runReactive(): Promise<TaskOutput> {
    return {};
  }
}

describe("TaskGraph", () => {
  let graph = new TaskGraph();
  let tasks: Task[];

  beforeEach(() => {
    graph = new TaskGraph();
    tasks = [
      new TestTask({ id: "task1" }),
      new TestTask({ id: "task2" }),
      new TestTask({ id: "task3" }),
    ];
  });

  it("should add nodes to the graph", () => {
    graph.addTasks(tasks);

    expect(graph.getTask("task1")).toBeDefined();
    expect(graph.getTask("task2")).toBeDefined();
    expect(graph.getTask("task3")).toBeDefined();
  });

  it("should add edges to the graph", () => {
    const edges: DataFlow[] = [
      new DataFlow("task1", "output1", "task2", "input1"),
      new DataFlow("task2", "output2", "task3", "input2"),
    ];

    graph.addTasks(tasks);
    graph.addDataFlows(edges);

    expect(graph.getDataFlow("task1.output1 -> task2.input1")).toBeDefined();
    expect(graph.getDataFlow("task2.output2 -> task3.input2")).toBeDefined();
  });

  it("should create a serial graph", () => {
    const inputHandle = "input";
    const outputHandle = "output";

    const expectedDataFlows: DataFlow[] = [
      new DataFlow("task1", inputHandle, "task2", outputHandle),
      new DataFlow("task2", inputHandle, "task3", outputHandle),
    ];

    const result = serialGraph(tasks, inputHandle, outputHandle);

    expect(result).toBeInstanceOf(TaskGraph);
    expect(result.getDataFlows()).toEqual(expectedDataFlows);
  });
});
