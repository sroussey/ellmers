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
import { CreateMappedType } from "../base/TaskIOTypes";
import { ConvertAllToArrays, ConvertOneToArray, arrayTaskFactory } from "../base/ArrayTask";

type TestSquareTaskInput = CreateMappedType<typeof TestSquareTask.inputs>;
type TestSquareTaskOutput = CreateMappedType<typeof TestSquareTask.outputs>;
class TestSquareTask extends SingleTask {
  static readonly type = "TestSquareTask";
  declare runInputData: TestSquareTaskInput;
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
  runSyncOnly(): TestSquareTaskOutput {
    return { output: this.runInputData.input * this.runInputData.input };
  }
}

type TestDoubleTaskInput = CreateMappedType<typeof TestDoubleTask.inputs>;
type TestDoubleTaskOutput = CreateMappedType<typeof TestDoubleTask.outputs>;
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
  runSyncOnly(): TestDoubleTaskOutput {
    return { output: this.runInputData.input * 2 };
  }
}

type TestAddTaskInput = CreateMappedType<typeof TestAddTask.inputs>;
type TestAddTaskOutput = CreateMappedType<typeof TestAddTask.outputs>;
class TestAddTask extends SingleTask {
  static readonly type = "TestAddTask";
  declare runInputData: TestAddTaskInput;
  declare runOutputData: TestAddTaskOutput;
  static inputs = [
    {
      id: "input",
      name: "Input",
      valueType: "number",
      isArray: true,
      defaultValue: [0],
    },
  ] as const;
  static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "number",
    },
  ] as const;
  runSyncOnly(): TaskOutput {
    const inputs = Array.isArray(this.runInputData.input)
      ? this.runInputData.input
      : [this.runInputData.input ?? 0];
    return { output: inputs.reduce((acc, cur) => acc + cur, 0) };
  }
}

export const TestSquareMultiInputTask = arrayTaskFactory<
  ConvertOneToArray<TestSquareTaskInput, "input">,
  ConvertAllToArrays<TestSquareTaskOutput>
>(TestSquareTask, "input");

describe("TaskGraphRunner", () => {
  let runner: TaskGraphRunner;
  let graph: TaskGraph;
  let nodes: Task[];

  beforeEach(() => {
    graph = new TaskGraph();
    nodes = [
      new TestSquareMultiInputTask({ id: "task1", input: { input: [6, 7] } }),
      new TestSquareTask({ id: "task2", input: { input: 5 } }),
      new TestDoubleTask({ id: "task3", input: { input: 5 } }),
    ];
    graph.addTasks(nodes);
    runner = new TaskGraphRunner(graph);
  });

  describe("runGraph array input", () => {
    it("should be able to have multiple inputs for array input type", async () => {
      const nodeRunSpy = spyOn(nodes[0], "run");

      const results = await runner.runGraph();

      expect(nodeRunSpy).toHaveBeenCalledTimes(1);
      expect(results[0]).toEqual({ output: [36, 49] });
    });

    it("array input into ArrayTask", async () => {
      const task = new TestSquareMultiInputTask({ id: "task4" });
      graph.addTask(task);
      graph.addDataFlow(new DataFlow("task2", "output", "task4", "input"));
      graph.addDataFlow(new DataFlow("task3", "output", "task4", "input"));

      const nodeRunSpy = spyOn(task, "run");
      const assignLayersSpy = spyOn(runner, "assignLayers");

      await runner.runGraph();
      await runner.runGraph();
      const results = await runner.runGraph();

      expect(assignLayersSpy).toHaveBeenCalled();
      expect(nodeRunSpy).toHaveBeenCalledTimes(3);
      expect(results[0].output).toEqual([625, 100]);
    });
  });
});
