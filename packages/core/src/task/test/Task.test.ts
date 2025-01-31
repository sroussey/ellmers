//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { SingleTask, CompoundTask } from "../base/Task";
import { TaskGraph } from "../base/TaskGraph";

type TestTaskInput = {
  key: string;
};
type TestTaskOutput = {
  reactiveOnly: boolean;
  all: boolean;
  key: string;
};
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
      id: "reactiveOnly",
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
  async runReactive(): Promise<TestTaskOutput> {
    return { all: false, key: this.runInputData.key, reactiveOnly: true };
  }
  async run(): Promise<TestTaskOutput> {
    return { all: true, key: this.runInputData.key, reactiveOnly: false };
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
      id: "reactiveOnly",
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
  async runReactive(): Promise<TestTaskOutput> {
    this.runOutputData = { key: this.runInputData.key, all: false, reactiveOnly: true };
    return this.runOutputData;
  }
  async run(): Promise<TestTaskOutput> {
    this.runOutputData = { key: this.runInputData.key, all: true, reactiveOnly: false };
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
      expect(output).toEqual({ ...input, reactiveOnly: false, all: true });
      expect(node.runInputData).toEqual(input);
    });

    it("should run the task reactively", async () => {
      const node = new TestTask();
      const output = await node.runReactive();
      expect(output).toEqual({ key: "", reactiveOnly: true, all: false });
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
      expect(output).toEqual({ key: "value", all: true, reactiveOnly: false });
      expect(node.runInputData).toEqual(input);
    });

    it("should run the task synchronously", async () => {
      const node = new TestCompoundTask({ input: { key: "value2" } });
      const output = await node.runReactive();
      expect(output).toEqual({ key: "value2", reactiveOnly: true, all: false });
    });
  });
});
