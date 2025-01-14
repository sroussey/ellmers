//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach } from "bun:test";
import { rmdirSync } from "fs";
import { SingleTask, TaskOutput, DataFlow, TaskGraph, TaskRegistry } from "ellmers-core";
import { InMemoryTaskGraphRepository } from "ellmers-storage/inmemory";

class TestTask extends SingleTask {
  static readonly type = "TestTask";
  runSyncOnly(): TaskOutput {
    return {};
  }
}
TaskRegistry.registerTask(TestTask);

describe("FileTaskGraphRepository", () => {
  let repository: InMemoryTaskGraphRepository;

  beforeEach(() => {
    rmdirSync(".cache/test/file-task-graph", { recursive: true });
    repository = new InMemoryTaskGraphRepository();
  });

  it("should initialize the kvRepository", () => {
    expect(repository.kvRepository).toBeDefined();
  });

  it("should store and retrieve task graph", async () => {
    const id: string = "g1";
    const graph = new TaskGraph();
    const tasks = [
      new TestTask({ id: "task1" }),
      new TestTask({ id: "task2" }),
      new TestTask({ id: "task3" }),
    ];
    const edges: DataFlow[] = [
      new DataFlow("task1", "output1", "task2", "input1"),
      new DataFlow("task2", "output2", "task3", "input2"),
    ];

    graph.addTasks(tasks);
    graph.addDataFlows(edges);

    expect(graph.getDataFlow("task1.output1 -> task2.input1")).toBeDefined();
    expect(graph.getDataFlow("task2.output2 -> task3.input2")).toBeDefined();

    await repository.saveTaskGraph(id, graph);
    const retrievedGraph = await repository.getTaskGraph(id);

    expect(retrievedGraph?.toJSON()).toEqual(graph?.toJSON());
  });

  it("should return undefined for non-existent task graph", async () => {
    const id: string = "g2";

    const retrievedGraph = await repository.getTaskGraph(id);

    expect(retrievedGraph).toBeUndefined();
  });
});
