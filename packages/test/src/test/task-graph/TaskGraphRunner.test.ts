/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyGraphResult, ITask, TaskOutput } from "@workglow/task-graph";
import {
  Dataflow,
  DataflowArrow,
  TaskAbortedError,
  TaskConfigurationError,
  TaskGraph,
  TaskGraphRunner,
  TaskGraphTimeoutError,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import {
  FailingTask,
  LongRunningTask,
  TestAddTask,
  TestDoubleTask,
  TestIOTask,
  TestSquareTask,
} from "../task/TestTasks";

const spyOn = vi.spyOn;

describe("TaskGraphRunner", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let runner: TaskGraphRunner;
  let graph: TaskGraph;
  let nodes: ITask[];

  beforeEach(() => {
    graph = new TaskGraph();
    nodes = [
      new TestIOTask({ id: "task0" }),
      new TestSquareTask({ id: "task1", defaults: { input: 5 } }),
      new TestDoubleTask({ id: "task2", defaults: { input: 5 } }),
    ];
    graph.addTasks(nodes);
    runner = new TaskGraphRunner(graph);
  });

  describe("Basic", () => {
    it("should run runPreview", async () => {
      const runPreviewSpy = spyOn(nodes[0], "runPreview");

      await runner.runGraphPreview();

      expect(runPreviewSpy).toHaveBeenCalledTimes(1);
    });

    it("should run the graph with results", async () => {
      const results = await runner.runGraph();

      if (Array.isArray(results)) {
        expect(results.find((r) => r.id === "task1")?.data.output).toEqual(25);
        expect(results.find((r) => r.id === "task2")?.data.output).toEqual(10);
      } else {
        expect(true).toEqual(false);
      }
    });

    it("should run the graph in the correct order with dependencies", async () => {
      const task3 = new TestAddTask({ id: "task3" });
      graph.addTask(task3);
      graph.addDataflow(new Dataflow("task1", "output", "task3", "a"));
      graph.addDataflow(new Dataflow("task2", "output", "task3", "b"));

      const results = await runner.runGraph();

      expect(nodes[1].runOutputData.output).toEqual(25);
      expect(nodes[2].runOutputData.output).toEqual(10);
      expect(results.find((r) => r.id === "task3")?.data.output).toEqual(35);
    });
  });

  describe("Status Dataflow Propagation", () => {
    let sourceTask: ITask;
    let errorTask: ITask;
    let targetTask: ITask;

    beforeEach(() => {
      graph = new TaskGraph();

      sourceTask = new TestSquareTask({ id: "source", defaults: { input: 5 } });
      targetTask = new TestDoubleTask({ id: "target", defaults: { input: 5 } });

      // Create a task that will throw an error
      errorTask = new FailingTask({ id: "error-source" });
      errorTask.executePreview = async () => {
        throw new Error("Test error");
      };

      graph.addTasks([sourceTask, targetTask, errorTask]);
      graph.addDataflow(new DataflowArrow("source[output] ==> target[input]"));
      graph.addDataflow(new DataflowArrow("error-source[output] ==> target[input]"));

      runner = new TaskGraphRunner(graph);
    });

    it("should propagate task status to dataflow edges", async () => {
      let runPromise: Promise<AnyGraphResult<TaskOutput>>;
      let error: Error | undefined;

      try {
        runPromise = runner.runGraph();
        await runPromise;
      } catch (err) {
        error = err as Error;
      }

      const sourceDataflows = graph.getTargetDataflows("source");
      expect(sourceDataflows.length).toBe(1);

      const sourceTask = graph.getTask("source");
      expect(sourceTask).toBeDefined();
      if (sourceTask) {
        expect(sourceTask.status).toBe(TaskStatus.COMPLETED);
        sourceDataflows.forEach((dataflow) => {
          expect(dataflow.status).toBe(sourceTask.status);
        });
      }

      const errorDataflows = graph.getTargetDataflows("error-source");
      expect(errorDataflows.length).toBe(1);
      expect(errorTask.status).toBe(TaskStatus.FAILED);
      expect(errorDataflows[0].status).toBe(errorTask.status);
      expect(error).toBeDefined();
    });

    it("should propagate task error to dataflow edges", async () => {
      await expect(runner.runGraph()).rejects.toThrow();

      const dataflows = graph.getTargetDataflows("error-source");
      expect(errorTask.status).toBe(TaskStatus.FAILED);
      expect(dataflows[0].status).toBe(errorTask.status);
      expect(dataflows.length).toBe(1);
      expect(dataflows[0].error).toBeDefined();
      if (dataflows[0].error && errorTask.error) {
        expect(dataflows[0].error).toBe(errorTask.error);
      }
    });

    it("should propagate task abort status to dataflow edges", async () => {
      // Create a graph with a long-running task
      graph = new TaskGraph();
      const longRunningTask = new LongRunningTask({ id: "long-running" });

      // Override the executePreview method to be long-running and check for abort signal
      longRunningTask.executePreview = async () => {
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1000);
            // Check if we're aborted and clean up
            // @ts-expect-error ts(2445)
            longRunningTask.abortController?.signal.addEventListener("abort", () => {
              clearTimeout(timeout);
              reject(new TaskAbortedError("Aborted"));
            });
          });
          return { output: "completed" };
        } catch (error) {
          // This should be caught by the task's error handling
          throw error;
        }
      };

      graph.addTask(longRunningTask);
      const abortTargetTask = new TestIOTask({ id: "abort-target" });
      graph.addTask(abortTargetTask);
      graph.addDataflow(new Dataflow("long-running", "output", "abort-target", "input"));

      runner = new TaskGraphRunner(graph);

      const runPromise = runner.runGraph();
      await sleep(1);
      runner.abort();
      try {
        await runPromise;
      } catch (error) {
        // Expected to fail due to abort
      }
      expect(longRunningTask.status).toBe(TaskStatus.ABORTING);
      const dataflows = graph.getTargetDataflows("long-running");
      expect(dataflows.length).toBe(1);
      expect(dataflows[0].status).toBe(TaskStatus.ABORTING);
      expect(dataflows[0].error).toBeDefined();
      expect(dataflows[0].error).toBeInstanceOf(TaskAbortedError);
    });
  });

  describe("Graph-level run limits", () => {
    it("should throw TaskConfigurationError when task count exceeds maxTasks", async () => {
      // graph already has 3 tasks (task0, task1, task2) from beforeEach
      await expect(runner.runGraph({}, { maxTasks: 2 })).rejects.toThrow(TaskConfigurationError);
      await expect(runner.runGraph({}, { maxTasks: 2 })).rejects.toThrow(
        "exceeding the limit of 2"
      );
    });

    it("should not throw when task count is within maxTasks", async () => {
      // 3 tasks in the graph, limit is 5 — should succeed
      const results = await runner.runGraph({}, { maxTasks: 5 });
      expect(Array.isArray(results)).toBe(true);
    });

    it("should not throw when maxTasks is undefined (no limit)", async () => {
      const results = await runner.runGraph({}, {});
      expect(Array.isArray(results)).toBe(true);
    });

    it("should abort the graph run and throw TaskGraphTimeoutError when timeout expires", async () => {
      const timeoutGraph = new TaskGraph();
      const longTask = new LongRunningTask({ id: "long" });
      timeoutGraph.addTask(longTask);
      const timeoutRunner = new TaskGraphRunner(timeoutGraph);

      await expect(timeoutRunner.runGraph({}, { timeout: 50 })).rejects.toThrow(
        TaskGraphTimeoutError
      );
    });

    it("TaskGraphTimeoutError message should describe graph timeout, not task timeout", async () => {
      const timeoutGraph = new TaskGraph();
      const longTask = new LongRunningTask({ id: "long" });
      timeoutGraph.addTask(longTask);
      const timeoutRunner = new TaskGraphRunner(timeoutGraph);

      try {
        await timeoutRunner.runGraph({}, { timeout: 50 });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TaskGraphTimeoutError);
        expect((err as TaskGraphTimeoutError).message).toContain("Graph execution timed out");
        expect((err as TaskGraphTimeoutError).message).toContain("50ms");
      }
    });

    it("should complete normally when the graph finishes before the timeout", async () => {
      // Small graph with fast tasks, generous timeout
      const results = await runner.runGraph({}, { timeout: 5000 });
      expect(Array.isArray(results)).toBe(true);
    });

    it("should not arm a timer when timeout is 0", async () => {
      // timeout: 0 should be ignored and the graph should run to completion
      const results = await runner.runGraph({}, { timeout: 0 });
      expect(Array.isArray(results)).toBe(true);
    });

    it("should enforce maxTasks in preview run via runGraphPreview", async () => {
      // 3 tasks, limit 1 — should throw TaskConfigurationError
      await expect(runner.runGraphPreview({}, { maxTasks: 1 })).rejects.toThrow(
        TaskConfigurationError
      );
    });
  });
});
