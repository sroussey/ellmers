//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import { TaskGraphRunner } from "../src/task/TaskGraphRunner";
import { Task, SingleTask, TaskOutput } from "../src/task/Task";
import { DataFlow, TaskGraph } from "../src/task/TaskGraph";

class TestTask extends SingleTask {
  static readonly type = "TestTask";
  runSyncOnly(): TaskOutput {
    return {};
  }
  async run(): Promise<TaskOutput> {
    return {};
  }
}

describe("TaskGraphRunner", () => {
  let runner: TaskGraphRunner;
  let graph: TaskGraph;
  let nodes: Task[];

  beforeEach(() => {
    graph = new TaskGraph();
    nodes = [
      new TestTask({ id: "task1" }),
      new TestTask({ id: "task2" }),
      new TestTask({ id: "task3" }),
    ];
    graph.addTasks(nodes);
    runner = new TaskGraphRunner(graph);
  });

  describe("assignLayers same layer", () => {
    it("should assign layers to nodes based on dependencies", () => {
      runner.assignLayers(nodes);

      expect(runner.layers.size).toBe(1);
      expect(runner.layers.get(0)?.[0]).toEqual(nodes[0]);
      expect(runner.layers.get(0)?.[1]).toEqual(nodes[1]);
      expect(runner.layers.get(0)?.[2]).toEqual(nodes[2]);
    });
  });

  describe("assignLayers different layers", () => {
    it("should assign layers to nodes based on dependencies", () => {
      graph.addDataFlows([
        new DataFlow("task1", "output", "task2", "input"),
        new DataFlow("task2", "output", "task3", "input"),
      ]);
      runner.assignLayers(nodes);

      expect(runner.layers.size).toBe(3);
      expect(runner.layers.get(0)).toEqual([nodes[0]]);
      expect(runner.layers.get(1)).toEqual([nodes[1]]);
      expect(runner.layers.get(2)).toEqual([nodes[2]]);
    });
  });

  describe("runNodesAsync", () => {
    it("should run nodes in each layer asynchronously", async () => {
      const runSpy = spyOn(nodes[0], "run");

      runner.assignLayers(nodes);
      await runner.runTasksAsync();

      expect(runSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("runNodesSync", () => {
    it("should run nodes in each layer synchronously", () => {
      const runSyncOnlySpy = spyOn(nodes[0], "runSyncOnly");

      runner.assignLayers(nodes);
      runner.runTasksSync();

      expect(runSyncOnlySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("runGraph", () => {
    it("should run the graph in the correct order", async () => {
      const assignLayersSpy = spyOn(runner, "assignLayers");
      const runNodesSyncSpy = spyOn(runner, "runTasksSync");
      const runNodesAsyncSpy = spyOn(runner, "runTasksAsync");

      await runner.runGraph();

      expect(assignLayersSpy).toHaveBeenCalled();
      expect(runNodesSyncSpy).toHaveBeenCalled();
      expect(runNodesAsyncSpy).toHaveBeenCalled();
    });
  });
});
