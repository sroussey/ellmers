/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import {
  Dataflow,
  DATAFLOW_ALL_PORTS,
  DATAFLOW_ERROR_PORT,
  Task,
  TaskAbortedError,
  TaskFailedError,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
  TaskTimeoutError,
  Workflow,
  type CachePolicy,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

// ========================================================================
// Test helper tasks
// ========================================================================

/**
 * A task that sleeps for a configurable duration, respecting abort signals.
 * Sleep duration is set via the sleepMs property.
 */
class SlowTask extends Task<{ input: number }, { output: number }> {
  static override readonly type = "SlowTask";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "number", default: 0 },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public sleepMs = 200;

  override async execute(
    input: { input: number },
    context: IExecuteContext
  ): Promise<{ output: number }> {
    const step = 10;
    for (let elapsed = 0; elapsed < this.sleepMs; elapsed += step) {
      if (context.signal.aborted) {
        throw new TaskAbortedError();
      }
      await sleep(step);
    }
    return { output: (input.input ?? 0) * 2 };
  }
}

/**
 * A task that always fails with a configurable message.
 */
class AlwaysFailTask extends Task<{ input: number }, { output: number }> {
  static override readonly type = "AlwaysFailTask";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "number", default: 0 },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<{ output: number }> {
    throw new TaskFailedError("Intentional failure");
  }
}

/**
 * A recovery task that receives error data and produces a fallback output.
 * Uses additionalProperties: true so it can receive any error shape.
 */
class ErrorRecoveryTask extends Task<Record<string, unknown>, { output: number }> {
  static override readonly type = "ErrorRecoveryTask";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: Record<string, unknown>): Promise<{ output: number }> {
    return { output: -1 };
  }
}

/**
 * A recovery task that itself fails — for testing nested error scenarios.
 */
class FailingRecoveryTask extends Task<Record<string, unknown>, { output: number }> {
  static override readonly type = "FailingRecoveryTask";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<{ output: number }> {
    throw new TaskFailedError("Recovery also failed");
  }
}

/**
 * A simple task that doubles its input.
 */
class DoubleTask extends Task<{ input: number }, { output: number }> {
  static override readonly type = "DoubleTask";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "number", default: 0 },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { input: number }): Promise<{ output: number }> {
    return { output: (input.input ?? 0) * 2 };
  }
}

/**
 * A recovery task that captures its input for inspection.
 */
class InspectingRecoveryTask extends Task<Record<string, unknown>, { output: number }> {
  static override readonly type = "InspectingRecoveryTask";
  static override cachePolicy: CachePolicy = { kind: "none" };
  public lastInput: Record<string, unknown> = {};

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: Record<string, unknown>): Promise<{ output: number }> {
    this.lastInput = { ...input };
    return { output: 42 };
  }
}

// ========================================================================
// Task-Level Timeout
// ========================================================================

describe("TimeoutAndErrorRouting", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("Task-Level Timeout", () => {
    it("should abort a slow task when timeout expires", async () => {
      const task = new SlowTask({ timeout: 50 });
      task.sleepMs = 500;

      await expect(task.run()).rejects.toThrow(TaskTimeoutError);
      expect(task.status).toBe(TaskStatus.ABORTING);
      expect(task.error).toBeInstanceOf(TaskTimeoutError);
      expect(task.error?.message).toContain("50ms");
    });

    it("should complete normally when task finishes before timeout", async () => {
      const task = new SlowTask({ timeout: 2000, defaults: { input: 5 } });
      task.sleepMs = 20;

      const output = await task.run();
      expect(output.output).toBe(10);
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });

    it("should not interfere when no timeout is set", async () => {
      const task = new SlowTask({ defaults: { input: 3 } });
      task.sleepMs = 20;

      const output = await task.run();
      expect(output.output).toBe(6);
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });

    it("should surface TaskTimeoutError (subclass of TaskAbortedError)", async () => {
      const task = new SlowTask({ timeout: 30 });
      task.sleepMs = 500;

      try {
        await task.run();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TaskTimeoutError);
        expect(err).toBeInstanceOf(TaskAbortedError);
      }
    });

    it("should emit abort event with TaskTimeoutError", async () => {
      const task = new SlowTask({ timeout: 30 });
      task.sleepMs = 500;
      let receivedError: unknown = null;

      task.on("abort", (error) => {
        receivedError = error;
      });

      await task.run().catch(() => {});

      expect(receivedError).toBeInstanceOf(TaskTimeoutError);
    });

    it("should work with timeout in a graph runner context", async () => {
      const graph = new TaskGraph();
      const slow = new SlowTask({ id: "slow", timeout: 50, defaults: { input: 5 } });
      slow.sleepMs = 500;

      graph.addTask(slow);
      const runner = new TaskGraphRunner(graph);

      await expect(runner.runGraph()).rejects.toThrow();
      expect(slow.status).toBe(TaskStatus.ABORTING);
      expect(slow.error).toBeInstanceOf(TaskTimeoutError);
    });

    it("should not arm a timer for timeout of zero", async () => {
      const task = new SlowTask({ timeout: 0, defaults: { input: 4 } });
      task.sleepMs = 20;

      const output = await task.run();
      expect(output.output).toBe(8);
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });

    it("should persist timeout in task config for serialization", () => {
      const task = new SlowTask({ timeout: 5000 });
      expect((task.config as Record<string, unknown>).timeout).toBe(5000);
    });
  });

  // ========================================================================
  // Error Output Ports / Error Routing
  // ========================================================================

  describe("Error Output Ports / Error Routing", () => {
    // ------------------------------------------------------------------
    // Graph-level error routing
    // ------------------------------------------------------------------

    describe("Graph-level error routing", () => {
      it("should route errors through error-port dataflows instead of failing the graph", async () => {
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail", defaults: { input: 5 } });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });

        graph.addTasks([failTask, recoveryTask]);
        graph.addDataflow(
          new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS)
        );

        const runner = new TaskGraphRunner(graph);
        const results = await runner.runGraph();

        expect(results.length).toBeGreaterThan(0);
        const recoveryResult = results.find((r) => r.id === "recovery");
        expect(recoveryResult).toBeDefined();
        expect(recoveryResult!.data).toEqual({ output: -1 });
      });

      it("should set error-port edges to COMPLETED and normal edges to DISABLED", async () => {
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail", defaults: { input: 5 } });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });
        const normalDownstream = new DoubleTask({ id: "normal", defaults: { input: 0 } });

        graph.addTasks([failTask, recoveryTask, normalDownstream]);
        graph.addDataflow(
          new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS)
        );
        graph.addDataflow(new Dataflow("fail", "output", "normal", "input"));

        const runner = new TaskGraphRunner(graph);
        await runner.runGraph();

        const errorEdges = graph
          .getTargetDataflows("fail")
          .filter((df) => df.sourceTaskPortId === DATAFLOW_ERROR_PORT);
        expect(errorEdges.length).toBe(1);
        expect(errorEdges[0].status).toBe(TaskStatus.COMPLETED);

        const normalEdges = graph
          .getTargetDataflows("fail")
          .filter((df) => df.sourceTaskPortId !== DATAFLOW_ERROR_PORT);
        expect(normalEdges.length).toBe(1);
        expect(normalEdges[0].status).toBe(TaskStatus.DISABLED);

        expect(normalDownstream.status).toBe(TaskStatus.DISABLED);
      });

      it("should still fail the graph when no error-port edges exist (backward compat)", async () => {
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail", defaults: { input: 5 } });

        graph.addTask(failTask);
        const runner = new TaskGraphRunner(graph);

        await expect(runner.runGraph()).rejects.toThrow(TaskFailedError);
      });

      it("should pass error data to the recovery task", async () => {
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail", defaults: { input: 5 } });
        const inspectTask = new InspectingRecoveryTask({ id: "inspect" });

        graph.addTasks([failTask, inspectTask]);
        graph.addDataflow(new Dataflow("fail", DATAFLOW_ERROR_PORT, "inspect", DATAFLOW_ALL_PORTS));

        const runner = new TaskGraphRunner(graph);
        await runner.runGraph();

        expect(inspectTask.lastInput).toHaveProperty("error");
        expect(inspectTask.lastInput).toHaveProperty("errorType");
        expect(inspectTask.lastInput.error).toBe("Intentional failure");
        expect(inspectTask.lastInput.errorType).toBe("TaskFailedError");
      });

      it("should allow chaining after error recovery", async () => {
        // fail --[error]--> recovery --[output]--> downstream
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail", defaults: { input: 5 } });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });
        const downstream = new DoubleTask({ id: "downstream" });

        graph.addTasks([failTask, recoveryTask, downstream]);
        graph.addDataflow(
          new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS)
        );
        graph.addDataflow(new Dataflow("recovery", "output", "downstream", "input"));

        const runner = new TaskGraphRunner(graph);
        const results = await runner.runGraph();

        // Recovery outputs -1, downstream doubles it to -2
        const downstreamResult = results.find((r) => r.id === "downstream");
        expect(downstreamResult).toBeDefined();
        expect(downstreamResult!.data).toEqual({ output: -2 });
      });

      it("should fail the graph when the recovery task itself fails", async () => {
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail", defaults: { input: 5 } });
        const failingRecovery = new FailingRecoveryTask({ id: "bad-recovery" });

        graph.addTasks([failTask, failingRecovery]);
        graph.addDataflow(
          new Dataflow("fail", DATAFLOW_ERROR_PORT, "bad-recovery", DATAFLOW_ALL_PORTS)
        );

        const runner = new TaskGraphRunner(graph);
        await expect(runner.runGraph()).rejects.toThrow("Recovery also failed");
      });

      it("should handle parallel tasks where one fails with error routing and one succeeds", async () => {
        // root1 (fails, error-routed) --> recovery
        // root2 (succeeds)            --> leaf
        const graph = new TaskGraph();
        const failTask = new AlwaysFailTask({ id: "fail" });
        const successTask = new DoubleTask({ id: "success", defaults: { input: 7 } });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });

        graph.addTasks([failTask, successTask, recoveryTask]);
        graph.addDataflow(
          new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS)
        );

        const runner = new TaskGraphRunner(graph);
        const results = await runner.runGraph();

        // Both the success task and recovery task should produce results
        const successResult = results.find((r) => r.id === "success");
        expect(successResult).toBeDefined();
        expect(successResult!.data).toEqual({ output: 14 });

        const recoveryResult = results.find((r) => r.id === "recovery");
        expect(recoveryResult).toBeDefined();
        expect(recoveryResult!.data).toEqual({ output: -1 });
      });

      it("should propagate through a deep chain: A fails → B recovers → C doubles → D doubles", async () => {
        const graph = new TaskGraph();
        const a = new AlwaysFailTask({ id: "a" });
        const b = new ErrorRecoveryTask({ id: "b" }); // produces { output: -1 }
        const c = new DoubleTask({ id: "c" }); // doubles to -2
        const d = new DoubleTask({ id: "d" }); // doubles to -4

        graph.addTasks([a, b, c, d]);
        graph.addDataflow(new Dataflow("a", DATAFLOW_ERROR_PORT, "b", DATAFLOW_ALL_PORTS));
        graph.addDataflow(new Dataflow("b", "output", "c", "input"));
        graph.addDataflow(new Dataflow("c", "output", "d", "input"));

        const runner = new TaskGraphRunner(graph);
        const results = await runner.runGraph();

        const dResult = results.find((r) => r.id === "d");
        expect(dResult).toBeDefined();
        expect(dResult!.data).toEqual({ output: -4 });
      });
    });

    // ------------------------------------------------------------------
    // Timeout + error routing combined
    // ------------------------------------------------------------------

    describe("Timeout + error routing combined", () => {
      it("should route a timeout error through error-port edges", async () => {
        const graph = new TaskGraph();
        const slow = new SlowTask({ id: "slow", timeout: 30 });
        slow.sleepMs = 500;
        const inspectTask = new InspectingRecoveryTask({ id: "inspect" });

        graph.addTasks([slow, inspectTask]);
        graph.addDataflow(new Dataflow("slow", DATAFLOW_ERROR_PORT, "inspect", DATAFLOW_ALL_PORTS));

        const runner = new TaskGraphRunner(graph);
        const results = await runner.runGraph();

        // The graph should succeed — timeout was routed to recovery
        const inspectResult = results.find((r) => r.id === "inspect");
        expect(inspectResult).toBeDefined();

        // Recovery task should have received timeout error data
        expect(inspectTask.lastInput.errorType).toBe("TaskTimeoutError");
        expect(inspectTask.lastInput.error).toContain("timed out");
      });

      it("should fail the graph when a timed-out task has no error-port edges", async () => {
        const graph = new TaskGraph();
        const slow = new SlowTask({ id: "slow", timeout: 30 });
        slow.sleepMs = 500;

        graph.addTask(slow);
        const runner = new TaskGraphRunner(graph);

        await expect(runner.runGraph()).rejects.toThrow();
        expect(slow.error).toBeInstanceOf(TaskTimeoutError);
      });
    });

    // ------------------------------------------------------------------
    // Workflow.onError() builder
    // ------------------------------------------------------------------

    describe("Workflow.onError()", () => {
      it("should add error-port dataflow from previous task to handler", () => {
        const workflow = new Workflow();
        const failTask = new AlwaysFailTask({ id: "fail" });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });

        workflow.graph.addTask(failTask);
        workflow.onError(recoveryTask);

        const dataflows = workflow.graph.getTargetDataflows("fail");
        const errorDataflows = dataflows.filter(
          (df) => df.sourceTaskPortId === DATAFLOW_ERROR_PORT
        );
        expect(errorDataflows.length).toBe(1);
        expect(errorDataflows[0].targetTaskId).toBe("recovery");
        expect(errorDataflows[0].targetTaskPortId).toBe(DATAFLOW_ALL_PORTS);
      });

      it("should throw if called without a preceding task", () => {
        const workflow = new Workflow();
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });

        expect(() => workflow.onError(recoveryTask)).toThrow("onError() requires a preceding task");
      });

      it("should be chainable and return the workflow", () => {
        const workflow = new Workflow();
        const failTask = new AlwaysFailTask({ id: "fail" });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });

        workflow.graph.addTask(failTask);
        const result = workflow.onError(recoveryTask);

        expect(result).toBe(workflow);
      });

      it("should work end-to-end: pipe → onError → pipe → run", async () => {
        // Build: fail → onError(recovery) → double
        // Expected: fail throws → recovery produces { output: -1 } → double produces { output: -2 }
        const workflow = new Workflow();

        const failTask = new AlwaysFailTask({ id: "fail" });
        const recoveryTask = new ErrorRecoveryTask({ id: "recovery" });
        const doubleTask = new DoubleTask({ id: "double" });

        // Build the graph manually since pipe() auto-wires normal ports
        workflow.graph.addTask(failTask);
        workflow.onError(recoveryTask);

        // Wire recovery output into double input, then add double
        workflow.graph.addTask(doubleTask);
        workflow.graph.addDataflow(new Dataflow("recovery", "output", "double", "input"));

        const runner = new TaskGraphRunner(workflow.toTaskGraph());
        const results = await runner.runGraph();

        const doubleResult = results.find((r) => r.id === "double");
        expect(doubleResult).toBeDefined();
        expect(doubleResult!.data).toEqual({ output: -2 });
      });
    });
  });
});
