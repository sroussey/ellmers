/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { ImageValue } from "@workglow/util/media";
import { previewSource } from "@workglow/util/media";
import type { ITask } from "../task/ITask";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskStatus } from "../task/TaskTypes";
import { DATAFLOW_ALL_PORTS, DATAFLOW_ERROR_PORT } from "./Dataflow";
import type { TaskGraph } from "./TaskGraph";
import type { TaskGraphRunner } from "./TaskGraphRunner";

/**
 * @internal
 * Reads inputs from incoming dataflows, writes outputs/errors to outgoing dataflows.
 * Owns dataflow transforms and error-port routing.
 *
 * Methods take the task they operate on. None take a RunContext — the caller
 * (TaskGraphRunner.runTask or RunScheduler.runLoop) is responsible for routing
 * any errors that bubble out of these methods into ctx.failedTaskErrors.
 *
 * Holds a back-reference to the facade so it can read facade-owned long-lived
 * state (`registry`, `previewRunning`) and route through the facade's
 * `runScheduler` for status push and disabled cascade.
 */
export class EdgeMaterializer {
  constructor(
    private readonly graph: TaskGraph,
    private readonly runner: TaskGraphRunner
  ) {}

  /**
   * Filters graph-level input to only include properties that are not connected via dataflows for a given task
   * @param task The task to filter input for
   * @param input The graph-level input
   * @returns Filtered input containing only unconnected properties
   */
  public filterInputForTask(task: ITask, input: TaskInput): TaskInput {
    // Get all inputs that are connected to this task via dataflows
    const sourceDataflows = this.graph.getSourceDataflows(task.id);
    const connectedInputs = new Set(sourceDataflows.map((df) => df.targetTaskPortId));

    // If DATAFLOW_ALL_PORTS ("*") is in the set, all inputs are connected
    const allPortsConnected = connectedInputs.has(DATAFLOW_ALL_PORTS);

    // Filter out connected inputs from the graph input
    const filteredInput: TaskInput = {};
    for (const [key, value] of Object.entries(input)) {
      // Skip this input if it's explicitly connected OR if all ports are connected
      if (!connectedInputs.has(key) && !allPortsConnected) {
        filteredInput[key] = value;
      }
    }

    return filteredInput;
  }

  /**
   * Copies input data from edges to a task
   * @param task The task to copy input data to
   */
  public copyInputFromEdgesToNode(task: ITask) {
    const dataflows = this.graph.getSourceDataflows(task.id);
    // Sort by dataflow id for deterministic input merging regardless of insertion order
    dataflows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const dataflow of dataflows) {
      // Use getCurrentValue() to pick up latestSnapshot when the edge is
      // mid-stream (i.e. value is undefined but latestSnapshot is populated).
      // We re-implement getPortData()'s wrapping with the live value.
      const live = dataflow.getCurrentValue();
      const port = dataflow.targetTaskPortId;
      let portData: TaskOutput;
      if (port === DATAFLOW_ALL_PORTS) {
        portData = live as TaskOutput;
      } else if (port === DATAFLOW_ERROR_PORT) {
        portData = { [DATAFLOW_ERROR_PORT]: dataflow.error } as unknown as TaskOutput;
      } else {
        portData = { [port]: live } as TaskOutput;
      }
      this.runner.addInputData(task, portData);
    }
  }

  /**
   * Pushes the output of a task to its target tasks
   * @param node The task that produced the output
   * @param results The output of the task
   */
  public async pushOutputFromNodeToEdges(node: ITask, results: TaskOutput) {
    const dataflows = this.graph.getTargetDataflows(node.id);

    // Preview-mode chain-head downscale: apply `previewSource` to any
    // image-shaped output before it's pushed downstream. This relocates the
    // per-task `executePreview` invocation of `previewSource` to the engine,
    // where it fires once per chain head and is idempotent on already-small
    // images (returns the input unchanged when within budget).
    if (this.runner.previewRunning && Object.keys(results).length > 0) {
      for (const port of Object.keys(results)) {
        const value = (results as Record<string, unknown>)[port];
        if (EdgeMaterializer.isImageValueShape(value)) {
          (results as Record<string, unknown>)[port] = await previewSource(value as ImageValue);
        }
      }
    }

    for (const dataflow of dataflows) {
      // Edges with an active stream have their final value materialised by the
      // downstream task's awaitStreamInputs (which uses Dataflow.awaitStreamValue
      // to read the raw snapshot/finish data and then applies transforms).
      // Setting port data here would be overwritten by the finish event, and
      // applying transforms again on this path would double-apply
      // non-idempotent transforms, so skip the whole post-materialisation step.
      if (dataflow.stream !== undefined) continue;
      const compatibility = dataflow.semanticallyCompatible(
        this.graph,
        dataflow,
        this.runner.registry
      );
      if (compatibility === "static") {
        dataflow.setPortData(results);
        await dataflow.applyTransforms(this.runner.registry);
      } else if (compatibility === "runtime") {
        const task = this.graph.getTask(dataflow.targetTaskId)!;
        const narrowed = await task.narrowInput({ ...results }, this.runner.registry);
        dataflow.setPortData(narrowed);
        await dataflow.applyTransforms(this.runner.registry);
      } else {
        // Warn only when we had data to push; empty results (e.g. progress mid-run) are expected
        const resultsKeys = Object.keys(results);
        if (resultsKeys.length > 0) {
          getLogger().warn("pushOutputFromNodeToEdge not compatible, not setting port data", {
            dataflowId: dataflow.id,
            compatibility,
            resultsKeys,
          });
        }
      }
    }
  }

  /**
   * Pushes the error of a task to its target edges
   * @param node The task that produced the error
   */
  public pushErrorFromNodeToEdges(node: ITask): void {
    if (!node?.config?.id) return;
    this.graph.getTargetDataflows(node.id).forEach((dataflow) => {
      dataflow.error = node.error;
    });
  }

  /**
   * Returns true if the task has any outgoing dataflow edges that use the
   * error output port (`[error]`). These edges indicate that the task's
   * errors should be routed to downstream handler tasks instead of failing
   * the entire graph.
   */
  public hasErrorOutputEdges(task: ITask): boolean {
    const dataflows = this.graph.getTargetDataflows(task.id);
    return dataflows.some((df) => df.sourceTaskPortId === DATAFLOW_ERROR_PORT);
  }

  /**
   * Routes a failed task's error through its error-port dataflow edges.
   *
   * For each outgoing dataflow:
   * - Error-port edges (`[error]`) receive the error data and get COMPLETED status
   * - Non-error-port edges get DISABLED status (the task didn't produce normal output)
   *
   * After setting edge statuses, propagateDisabledStatus() cascades DISABLED
   * through any downstream tasks that only had non-error inputs from this task.
   */
  public pushErrorOutputToEdges(task: ITask): void {
    const taskError = task.error;
    const errorData = {
      error: taskError?.message ?? "Unknown error",
      errorType: (taskError?.constructor as { type?: string })?.type ?? "TaskError",
    };

    const dataflows = this.graph.getTargetDataflows(task.id);
    for (const df of dataflows) {
      if (df.sourceTaskPortId === DATAFLOW_ERROR_PORT) {
        // Route error data to the error-port edge
        df.value = errorData;
        df.setStatus(TaskStatus.COMPLETED);
      } else {
        // Normal output edges are disabled — this task didn't produce output
        df.setStatus(TaskStatus.DISABLED);
      }
    }

    // Cascade disabled status to downstream tasks whose ALL inputs are now disabled
    this.runner.runScheduler.propagateDisabledStatus(this.runner["currentCtx"]);
  }

  /**
   * Resets a task. Takes an explicit `graph` because `resetGraph` recurses
   * into `node.subGraph` for nested tasks and the EdgeMaterializer's own
   * `this.graph` reference is bound to the top-level graph only.
   *
   * @param graph The task graph that owns the task being reset
   * @param task The task to reset
   * @param runId The run ID
   */
  public resetTask(graph: TaskGraph, task: ITask, runId: string) {
    task.status = TaskStatus.PENDING;
    task.resetInputData();
    task.runOutputData = {};
    task.error = undefined;
    task.progress = 0;
    task.runConfig = { ...task.runConfig, runnerId: runId };
    this.runner.runScheduler.pushStatusFromNodeToEdges(
      task,
      this.runner["currentCtx"],
      undefined,
      graph
    );
    // Inline the error-edge reset using the per-call graph (this.pushErrorFromNodeToEdges
    // would use this.graph, which is wrong for recursive subgraph resets).
    if (task?.config?.id) {
      graph.getTargetDataflows(task.id).forEach((dataflow) => {
        dataflow.error = task.error;
      });
    }
    task.emit("reset");
    task.emit("status", task.status);
  }

  /**
   * Duck-typed predicate for an `ImageValue`-shaped output, used by the engine
   * to decide whether to apply `previewSource` during `runPreview`. Unlike
   * `isImageValue` from `@workglow/util/media`, this predicate does not check
   * `instanceof ImageBitmap` / `Buffer.isBuffer`, so it remains correct across
   * realm boundaries (e.g. bundle copies in test harnesses) where those identity
   * checks can spuriously fail.
   */
  private static isImageValueShape(
    v: unknown
  ): v is { width: number; height: number; previewScale: number } {
    if (v === null || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return (
      typeof o.width === "number" &&
      typeof o.height === "number" &&
      typeof o.previewScale === "number"
    );
  }
}
