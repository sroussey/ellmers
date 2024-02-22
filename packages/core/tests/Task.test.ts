import { describe, expect, it } from "bun:test";
import { SingleTask, CompoundTask } from "../src/task/Task";
import { TaskGraph } from "../src/task/TaskGraph";
import { TaskOutput } from "../dist/lib";

class TestTask extends SingleTask {
  static readonly type = "TestTask";
  runSyncOnly(): TaskOutput {
    return { syncOnly: true };
  }
  async run(): Promise<TaskOutput> {
    return { all: true };
  }
}

class TestCompoundTask extends CompoundTask {
  static readonly type = "TestTask";
  runSyncOnly(): TaskOutput {
    return Object.assign(this.runOutputData, this.runInputData, { syncOnly: true });
  }
  async run(): Promise<TaskOutput> {
    return Object.assign(this.runOutputData, this.runInputData, { all: true });
  }
}

describe("Task", () => {
  describe("SingleTask", () => {
    it("should set input data and run the task", async () => {
      const node = new TestTask();
      const input = { key: "value" };
      const output = await node.runWithInput(input);
      expect(output).toEqual({ all: true });
      expect(node.runInputData).toEqual(input);
    });

    it("should run the task synchronously", () => {
      const node = new TestTask();
      const output = node.runSyncOnly();
      expect(output).toEqual({ syncOnly: true });
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
      const output = await node.runWithInput(input);
      expect(output).toEqual({ key: "value", all: true });
      expect(node.runInputData).toEqual(input);
    });

    it("should run the task synchronously", () => {
      const node = new TestCompoundTask({ input: { key: "value2" } });
      const output = node.runSyncOnly();
      expect(output).toEqual({ key: "value2", syncOnly: true });
    });
  });
});
