/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GraphResultArray,
  GraphSingleTaskResult,
  ITask,
  TaskOutput,
} from "@workglow/task-graph";
import {
  Dataflow,
  TaskAbortedError,
  TaskError,
  TaskFailedError,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import {
  FailingTask,
  FAILURE_MESSAGE,
  LongRunningTask,
  TestDoubleTask,
  TestSquareTask,
} from "../task/TestTasks";

describe("TaskSubGraphRunner", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let runner: TaskGraphRunner;
  let graph: TaskGraph;

  beforeEach(() => {
    graph = new TaskGraph();
    runner = new TaskGraphRunner(graph);
  });

  describe("runGraph array input", () => {
    let nodes: ITask[];
    beforeEach(() => {
      nodes = [
        new TestSquareTask({ id: "task1", defaults: { input: 5 } }),
        new TestDoubleTask({ id: "task2", defaults: { input: 5 } }),
      ];
      graph.addTasks(nodes);
    });

    it("should be able to have multiple inputs for array input type", async () => {
      const results = await runner.runGraph<TaskOutput>();

      expect(results.length).toEqual(2);
      expect(
        results.find((r: GraphSingleTaskResult<TaskOutput>) => r.id === "task2")?.data
      ).toEqual({
        output: 10,
      });
    });
  });

  describe("error handling", () => {
    it("should handle task failure", async () => {
      const failingTask = new FailingTask({ id: "failingTaskId" });
      graph.addTask(failingTask);

      let error: TaskFailedError | undefined;
      let result: GraphResultArray<TaskOutput> | TaskOutput | undefined;
      try {
        result = await runner.runGraph<TaskOutput>();
      } catch (err) {
        error = err as TaskFailedError;
      }

      expect(result).toBeUndefined();
      expect(error).toBeInstanceOf(TaskFailedError);
      expect(error?.name).toBe(TaskFailedError.name);
      expect(failingTask.status).toBe(TaskStatus.FAILED);
      expect(failingTask.error?.message).toBe(FAILURE_MESSAGE);
    });

    it("should handle task abortion", async () => {
      const longRunningTask = new LongRunningTask({ id: "longRunningTaskId" });
      graph.addTask(longRunningTask);

      let error: TaskError | undefined;
      try {
        const resultPromise = runner.runGraph<TaskOutput>();
        await sleep(50);
        runner.abort();
        await resultPromise;
      } catch (err) {
        error = err as TaskError;
      }

      expect(error).toBeInstanceOf(TaskAbortedError);
      expect(error?.name).toBe(TaskAbortedError.name);
    });

    it("should handle task failure in a chain", async () => {
      const squareTask = new TestSquareTask({ id: "square", defaults: { input: 5 } });
      const failingTask = new FailingTask({ id: "failing" });
      graph.addTasks([squareTask, failingTask]);
      graph.addDataflow(new Dataflow("square", "output", "failing", "in"));

      let error: TaskError | undefined;
      try {
        await runner.runGraph();
      } catch (err) {
        error = err as TaskError;
      }
      expect(error).toBeInstanceOf(TaskFailedError);
      expect(error?.name).toBe(TaskFailedError.name);
      expect(squareTask.status).toBe(TaskStatus.COMPLETED);
      expect(failingTask.status).toBe(TaskStatus.FAILED);
      expect(failingTask.error?.message).toBe(FAILURE_MESSAGE);
    });

    it("should handle multiple task failures", async () => {
      const failingTask1 = new FailingTask({ id: "failing1" });
      const failingTask2 = new FailingTask({ id: "failing2" });
      graph.addTasks([failingTask1, failingTask2]);
      graph.addDataflow(new Dataflow("failing1", "out", "failing2", "in"));

      let error: TaskError | undefined;
      try {
        await runner.runGraph();
      } catch (err) {
        error = err as TaskError;
      }
      expect(error).toBeInstanceOf(TaskFailedError);
      expect(error?.name).toBe(TaskFailedError.name);
      expect(failingTask1.status).toBe(TaskStatus.FAILED);
      expect(failingTask2.status).toBe(TaskStatus.PENDING); // failer before it started
      expect(failingTask1.error?.message).toBe(FAILURE_MESSAGE);
    });
  });

  describe("abort handling", () => {
    it("should handle task aborting immediately", async () => {
      const abortingTask = new FailingTask({ id: "abortingTaskId" });
      graph.addTask(abortingTask);

      let error: TaskError | undefined;
      try {
        const resultPromise = runner.runGraph();
        runner.abort();
        await resultPromise;
      } catch (err) {
        error = err as TaskError;
      }
      expect(error).toBeInstanceOf(TaskError);
      expect(abortingTask.status).toBe(TaskStatus.PENDING); // no delay, so it should not have started
    });

    it("should handle task aborting after a delay", async () => {
      const abortingTask = new FailingTask({ id: "abortingTaskId" });
      graph.addTask(abortingTask);

      let error: TaskError | undefined;
      try {
        const resultPromise = runner.runGraph<TaskOutput>();
        await sleep(1);
        runner.abort();
        await resultPromise;
      } catch (err) {
        error = err as TaskError;
      }
      expect(error?.name).toBe(TaskAbortedError.name);
      expect(abortingTask.status).toBe(TaskStatus.ABORTING);
    });

    it("should handle task aborting in a chain, immediate abort", async () => {
      const squareTask = new TestSquareTask({ id: "square", defaults: { input: 5 } });
      const failingTask = new FailingTask({ id: "failing" });
      graph.addTasks([squareTask, failingTask]);
      graph.addDataflow(new Dataflow("square", "output", "failing", "in"));

      let error: TaskError | undefined;
      try {
        const resultPromise = runner.runGraph();
        runner.abort();
        await resultPromise;
      } catch (err) {
        error = err as TaskError;
      }
      expect(squareTask.status).toBe(TaskStatus.PENDING);
      expect(failingTask.status).toBe(TaskStatus.PENDING);
      expect(error?.name).toBe(TaskAbortedError.name);
    });

    it("should handle task aborting in a chain, delayed abort", async () => {
      const squareTask = new TestSquareTask({ id: "square", defaults: { input: 5 } });
      const failingTask = new FailingTask({ id: "failing" });
      graph.addTasks([squareTask, failingTask]);
      graph.addDataflow(new Dataflow("square", "output", "failing", "in"));

      let error: TaskError | undefined;
      try {
        const resultPromise = runner.runGraph();
        await sleep(1);
        runner.abort();
        await resultPromise;
      } catch (err) {
        error = err as TaskError;
      }
      expect(squareTask.status).toBe(TaskStatus.COMPLETED);
      expect(failingTask.status).toBe(TaskStatus.ABORTING);
      expect(error?.name).toBe(TaskAbortedError.name);
    });

    it("should handle multiple task abortings", async () => {
      const abortingTask1 = new FailingTask({ id: "aborting1" });
      const abortingTask2 = new FailingTask({ id: "aborting2" });
      graph.addTasks([abortingTask1, abortingTask2]);
      graph.addDataflow(new Dataflow("aborting1", "output", "aborting2", "input"));

      let error: Error | undefined;
      try {
        const resultPromise = runner.runGraph();
        await sleep(1);
        runner.abort();
        await resultPromise;
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(abortingTask1.status).toBe(TaskStatus.ABORTING);
      expect(abortingTask2.status).toBe(TaskStatus.PENDING);
      expect(abortingTask1.error).toBeInstanceOf(TaskAbortedError);
      expect(abortingTask2.error).toBeUndefined();
    });
  });
});
