//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { SingleTask, CompoundTask } from "../base/Task";
import { TaskGraph } from "../base/TaskGraph";
import { CreateMappedType } from "../base/TaskIOTypes";

type TestTaskInput = CreateMappedType<typeof TestTask.inputs>;
type TestTaskOutput = CreateMappedType<typeof TestTask.outputs>;
class TestTask extends SingleTask {
  static readonly type = "TestTask";
  declare runInputData: TestTaskInput;
  declare runOutputData: TestTaskOutput;
  static readonly inputs = [
    {
      id: "key",
      name: "Input",
      valueType: "text",
      defaultValue: "",
    },
  ] as const;
  static readonly outputs = [
    {
      id: "syncOnly",
      name: "Output",
      valueType: "boolean",
    },
    {
      id: "all",
      name: "Output",
      valueType: "boolean",
    },
    {
      id: "key",
      name: "Output",
      valueType: "text",
    },
  ] as const;
  runSyncOnly(): TestTaskOutput {
    return { all: false, key: this.runInputData.key, syncOnly: true };
  }
  async run(): Promise<TestTaskOutput> {
    return { all: true, key: this.runInputData.key, syncOnly: false };
  }
}

class TestCompoundTask extends CompoundTask {
  declare runInputData: TestTaskInput;
  declare runOutputData: TestTaskOutput;
  static readonly inputs = [
    {
      id: "key",
      name: "Input",
      valueType: "text",
      defaultValue: "",
    },
  ] as const;
  static readonly outputs = [
    {
      id: "syncOnly",
      name: "Output",
      valueType: "boolean",
    },
    {
      id: "all",
      name: "Output",
      valueType: "boolean",
    },
    {
      id: "key",
      name: "Output",
      valueType: "text",
    },
  ] as const;
  static readonly type = "TestCompoundTask";
  runSyncOnly(): TestTaskOutput {
    this.runOutputData = { key: this.runInputData.key, all: false, syncOnly: true };
    return this.runOutputData;
  }
  async run(): Promise<TestTaskOutput> {
    this.runOutputData = { key: this.runInputData.key, all: true, syncOnly: false };
    return this.runOutputData;
  }
}

describe("Task", () => {
  describe("SingleTask", () => {
    it("should set input data and run the task", async () => {
      const node = new TestTask();
      const input = { key: "value" };
      node.addInputData(input);
      const output = await node.run();
      expect(output).toEqual({ ...input, syncOnly: false, all: true });
      expect(node.runInputData).toEqual(input);
    });

    it("should run the task synchronously", () => {
      const node = new TestTask();
      const output = node.runSyncOnly();
      expect(output).toEqual({ key: "", syncOnly: true, all: false });
    });
  });

  describe("CompoundTask", () => {
    it("should create a CompoundTask", () => {
      const node = new TestCompoundTask();
      expect(node).toBeInstanceOf(CompoundTask);
    });

    it("should create a subgraph for the CompoundTask", () => {
      const node = new TestCompoundTask();
      const subGraph = node.subGraph;
      expect(subGraph).toBeInstanceOf(TaskGraph);
    });

    it("should set input data and run the task", async () => {
      const node = new TestCompoundTask();
      const input = { key: "value" };
      node.addInputData(input);
      const output = await node.run();
      expect(output).toEqual({ key: "value", all: true, syncOnly: false });
      expect(node.runInputData).toEqual(input);
    });

    it("should run the task synchronously", () => {
      const node = new TestCompoundTask({ input: { key: "value2" } });
      const output = node.runSyncOnly();
      expect(output).toEqual({ key: "value2", syncOnly: true, all: false });
    });
  });
});
