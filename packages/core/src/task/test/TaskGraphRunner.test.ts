//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import { TaskGraphRunner } from "../base/TaskGraphRunner";
import { Task, SingleTask, TaskOutput } from "../base/Task";
import { DataFlow, TaskGraph } from "../base/TaskGraph";

class TestTask extends SingleTask {
  static readonly type = "TestTask";
  async runReactive(): Promise<TaskOutput> {
    return {};
  }
}

type TestSquareTaskInput = {
  input: number;
};
type TestSquareTaskOutput = {
  output: number;
};
class TestSquareTask extends SingleTask {
  static readonly type = "TestSquareTask";
  declare runInputData: TestSquareTaskInput;
  declare defaults: Partial<TestSquareTaskInput>;
  declare runOutputData: TestSquareTaskOutput;
  static inputs = [
    {
      id: "input",
      name: "Input",
      valueType: "number",
      defaultValue: 0,
    },
  ] as const;
  static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "number",
    },
  ] as const;
  async runReactive(): Promise<TestSquareTaskOutput> {
    return { output: this.runInputData.input * this.runInputData.input };
  }
}

type TestDoubleTaskInput = {
  input: number;
};
type TestDoubleTaskOutput = {
  output: number;
};
class TestDoubleTask extends SingleTask {
  static readonly type = "TestDoubleTask";
  declare runInputData: TestDoubleTaskInput;
  declare runOutputData: TestDoubleTaskOutput;
  static inputs = [
    {
      id: "input",
      name: "Input",
      valueType: "number",
      defaultValue: 0,
    },
  ] as const;
  static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "number",
    },
  ] as const;
  async runReactive(): Promise<TestDoubleTaskOutput> {
    return { output: this.runInputData.input * 2 };
  }
}

type TestAddTaskInput = {
  a: number;
  b: number;
};
type TestAddTaskOutput = {
  output: number;
};
class TestAddTask extends SingleTask {
  static readonly type = "TestAddTask";
  declare runInputData: TestAddTaskInput;
  declare runOutputData: TestAddTaskOutput;
  static inputs = [
    {
      id: "a",
      name: "Input",
      valueType: "number",
      defaultValue: 0,
    },
    {
      id: "b",
      name: "Input",
      valueType: "number",
      defaultValue: 0,
    },
  ] as const;
  static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "number",
    },
  ] as const;
  async runReactive(): Promise<TestAddTaskOutput> {
    const input = this.runInputData;
    return { output: input.a + input.b };
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
      new TestSquareTask({ id: "task2", input: { input: 5 } }),
      new TestDoubleTask({ id: "task3", input: { input: 5 } }),
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

  describe("runGraphReactive", () => {
    it("should run nodes in each layer synchronously", async () => {
      const runReactiveSpy = spyOn(nodes[0], "runReactive");

      await runner.runGraphReactive();

      expect(runReactiveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("runGraph", () => {
    it("should run the graph in the correct order", async () => {
      const assignLayersSpy = spyOn(runner, "assignLayers");

      const results = await runner.runGraph();

      expect(assignLayersSpy).toHaveBeenCalled();
      expect(results[1].output).toEqual(25);
      expect(results[2].output).toEqual(10);
    });
  });

  describe("runGraph 2", () => {
    it("should run the graph in the correct order", async () => {
      const task = new TestAddTask({ id: "task4" });
      graph.addTask(task);
      graph.addDataFlow(new DataFlow("task2", "output", "task4", "a"));
      graph.addDataFlow(new DataFlow("task3", "output", "task4", "b"));

      const nodeRunSpy = spyOn(task, "run");
      const assignLayersSpy = spyOn(runner, "assignLayers");

      const results = await runner.runGraph();

      expect(assignLayersSpy).toHaveBeenCalled();
      expect(nodeRunSpy).toHaveBeenCalledTimes(1);
      expect(results[0].output).toEqual(35);
    });
  });
});
