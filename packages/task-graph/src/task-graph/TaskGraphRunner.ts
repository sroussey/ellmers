/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISpan } from "@workglow/util";
import {
  collectPropertyValues,
  ConvertAllToOptionalArray,
  getLogger,
  getTelemetryProvider,
  globalServiceRegistry,
  ResourceScope,
  ServiceRegistry,
  SpanStatusCode,
  uuid4,
} from "@workglow/util";
import { previewSource } from "@workglow/util/media";
import type { ImageValue } from "@workglow/util/media";
import { TASK_OUTPUT_REPOSITORY, TaskOutputRepository } from "../storage/TaskOutputRepository";
import { ConditionalTask } from "../task/ConditionalTask";
import type { IEntitlementEnforcer } from "../task/EntitlementEnforcer";
import { ENTITLEMENT_ENFORCER, formatEntitlementDenial } from "../task/EntitlementEnforcer";
import { ITask } from "../task/ITask";
import type { StreamEvent, StreamMode } from "../task/StreamTypes";
import {
  edgeNeedsAccumulation,
  getOutputStreamMode,
  getStreamingPorts,
  isTaskStreamable,
} from "../task/StreamTypes";
import { Task } from "../task/Task";
import {
  TaskAbortedError,
  TaskConfigurationError,
  TaskEntitlementError,
  TaskError,
  TaskGraphTimeoutError,
} from "../task/TaskError";
import { TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { Dataflow, DATAFLOW_ALL_PORTS, DATAFLOW_ERROR_PORT } from "./Dataflow";
import { computeGraphEntitlements } from "./GraphEntitlementUtils";
import { TaskGraph, TaskGraphRunConfig, TaskGraphRunPreviewConfig } from "./TaskGraph";
import { DependencyBasedScheduler, TopologicalScheduler } from "./TaskGraphScheduler";

/**
 * Identifies tasks whose progress is meaningful to graph-level averaging. A task contributes when
 * it does real work — either because:
 *
 *   - it declares its own `execute` on the subclass prototype (standard case), or
 *   - it declares its own `executeStream` on the subclass prototype (streaming tasks keep their
 *     `execute` on `Task.prototype` but still do real work), or
 *   - it wraps a subgraph (`hasChildren()` — e.g. `GraphAsTask` / `WorkflowAsTask` /
 *     `IteratorTask` / `WhileTask` / `FallbackTask`). Their runners route subgraph
 *     `graph_progress` through {@link TaskRunner.handleProgress}, so `task.progress` tracks
 *     the nested work and the averaging is accurate.
 *
 * Tasks flagged `isPassthrough` (e.g. `InputTask`, `OutputTask`) are always excluded: they only
 * forward data and would jump from 0% to 100%, diluting the bar.
 */
export function taskPrototypeHasOwnExecute(task: ITask): boolean {
  const Ctor = task.constructor as typeof Task;
  if (Ctor.isPassthrough) return false;
  return (
    Object.hasOwn(Ctor.prototype, "execute") ||
    Object.hasOwn(Ctor.prototype, "executeStream") ||
    task.hasChildren()
  );
}

export type GraphSingleTaskResult<T> = {
  id: unknown;
  type: String;
  data: T;
};
export type GraphResultArray<T> = Array<GraphSingleTaskResult<T>>;
export type PropertyArrayGraphResult<T> = ConvertAllToOptionalArray<T>;
export type AnyGraphResult<T> = PropertyArrayGraphResult<T> | GraphResultArray<T>;

export const PROPERTY_ARRAY = "PROPERTY_ARRAY" as const;
export const GRAPH_RESULT_ARRAY = "GRAPH_RESULT_ARRAY" as const;

export type GraphResultMap<T> = {
  // array of results with id for tasks that created them -- output is an array of {id, type, data}[]
  [GRAPH_RESULT_ARRAY]: GraphResultArray<T>;
  // property-array -- output is consolidation of each output property, with duplicate properties turned into an array
  [PROPERTY_ARRAY]: PropertyArrayGraphResult<T>;
};

/**
 * Enum representing the possible compound merge strategies
 */
export type CompoundMergeStrategy = typeof PROPERTY_ARRAY | typeof GRAPH_RESULT_ARRAY;

export type GraphResult<
  Output,
  Merge extends CompoundMergeStrategy,
> = GraphResultMap<Output>[Merge];

/**
 * Duck-typed predicate for an `ImageValue`-shaped output, used by the engine
 * to decide whether to apply `previewSource` during `runPreview`. Unlike
 * `isImageValue` from `@workglow/util/media`, this predicate does not check
 * `instanceof ImageBitmap` / `Buffer.isBuffer`, so it remains correct across
 * realm boundaries (e.g. bundle copies in test harnesses) where those identity
 * checks can spuriously fail.
 */
function isImageValueShape(v: unknown): v is { width: number; height: number; previewScale: number } {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.previewScale === "number"
  );
}

/**
 * Class for running a task graph
 * Manages the execution of tasks in a task graph, including caching
 */
export class TaskGraphRunner {
  /**
   * Whether the task graph is currently running
   */
  protected running = false;
  protected previewRunning = false;

  /**
   * The task graph to run
   */
  public readonly graph: TaskGraph;

  /**
   * Output cache repository
   */
  protected outputCache?: TaskOutputRepository;
  /**
   * Whether leaf tasks (no outgoing edges) should accumulate their streaming
   * output. True by default so workflow return values are complete.
   */
  protected accumulateLeafOutputs: boolean = true;
  /**
   * Service registry for this graph run
   */
  protected registry: ServiceRegistry = globalServiceRegistry;
  /**
   * Resource scope for this graph run
   */
  protected resourceScope?: ResourceScope;
  /**
   * AbortController for cancelling graph execution
   */
  protected abortController: AbortController | undefined;

  /**
   * Maps to track task execution state
   */
  protected inProgressTasks: Map<unknown, Promise<TaskOutput>> = new Map();
  protected inProgressFunctions: Map<unknown, Promise<void>> = new Map();
  protected failedTaskErrors: Map<unknown, TaskError> = new Map();

  /**
   * Active telemetry span for the current graph run.
   */
  protected telemetrySpan?: ISpan;

  /**
   * Timer handle for graph-level timeout. Cleared on completion, error, or abort.
   */
  protected graphTimeoutTimer?: ReturnType<typeof setTimeout>;

  /**
   * When a graph-level timeout fires, this stores the error so handleAbort()
   * can surface the correct error type.
   */
  protected pendingGraphTimeoutError?: TaskGraphTimeoutError;

  /**
   * The entitlement enforcer for the current run, if enforcement is enabled.
   * Set during handleStart and cleared after the run completes.
   */
  protected activeEnforcer?: IEntitlementEnforcer;

  /**
   * Constructor for TaskGraphRunner
   * @param graph The task graph to run
   * @param outputCache The task output repository to use for caching task outputs
   * @param processScheduler The scheduler to use for task execution
   * @param previewScheduler The scheduler to use for preview task execution
   */
  constructor(
    graph: TaskGraph,
    outputCache?: TaskOutputRepository,
    protected processScheduler = new DependencyBasedScheduler(graph),
    protected previewScheduler = new TopologicalScheduler(graph)
  ) {
    this.graph = graph;
    graph.outputCache = outputCache;
    this.handleProgress = this.handleProgress.bind(this);
  }

  /**
   * Unique ID for the current run, used for timing labels.
   */
  protected runId: string = "";

  // ========================================================================
  // Public methods
  // ========================================================================

  public async runGraph<ExecuteOutput extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config?: TaskGraphRunConfig
  ): Promise<GraphResultArray<ExecuteOutput>> {
    await this.handleStart(config);

    const results: GraphResultArray<ExecuteOutput> = [];
    let error: TaskError | undefined;

    try {
      // TODO: A different graph runner may chunk tasks that are in parallel
      // rather them all currently available
      for await (const task of this.processScheduler.tasks()) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        if (this.failedTaskErrors.size > 0) {
          break;
        }

        const isRootTask = this.graph.getSourceDataflows(task.id).length === 0;

        const runAsync = async () => {
          let errorRouted = false;
          try {
            // Root tasks (no incoming dataflows) receive the graph run input so e.g.
            // InputTask can seed the graph. Downstream tasks rely only on dataflow
            // edges plus task defaults — unless matchAllEmptyInputs is true, in which case
            // we filter the input to only include properties that are not connected via dataflows.
            const taskInput = isRootTask
              ? input
              : config?.matchAllEmptyInputs
                ? this.filterInputForTask(task, input)
                : {};

            const taskPromise = this.runTask(task, taskInput);
            this.inProgressTasks!.set(task.id, taskPromise);
            const taskResult = await taskPromise;

            if (this.graph.getTargetDataflows(task.id).length === 0) {
              // we save the results of all the leaves
              results.push(taskResult as GraphSingleTaskResult<ExecuteOutput>);
            }
          } catch (error) {
            if (this.hasErrorOutputEdges(task)) {
              // Route the error through error-port dataflows instead of failing the graph.
              // pushErrorOutputToEdges sets edge statuses directly (COMPLETED for error
              // edges, DISABLED for normal edges), so we skip the normal status push.
              errorRouted = true;
              this.pushErrorOutputToEdges(task);
            } else {
              this.failedTaskErrors.set(task.id, error as TaskError);
            }
          } finally {
            // IMPORTANT: Push status to edges BEFORE notifying scheduler
            // This ensures dataflow statuses (including DISABLED) are set
            // before the scheduler checks which tasks are ready.
            // Skip normal status push when error routing already set edge statuses.
            if (!errorRouted) {
              this.pushStatusFromNodeToEdges(this.graph, task);
              this.pushErrorFromNodeToEdges(this.graph, task);
            }
            this.processScheduler.onTaskCompleted(task.id);
          }
        };

        // Start task execution without awaiting
        // so we can have many tasks running in parallel
        // but keep track of them to make sure they get awaited
        // otherwise, things will finish after this promise is resolved
        this.inProgressFunctions.set(Symbol(task.id as string), runAsync());
      }
    } catch (err) {
      error = err as Error;
      getLogger().error("Error running graph", { error });
    }
    // Wait for all tasks to complete since we did not await runAsync()/this.runTaskWithProvenance()
    await Promise.allSettled(Array.from(this.inProgressTasks.values()));
    // Clean up stragglers to avoid unhandled promise rejections
    await Promise.allSettled(Array.from(this.inProgressFunctions.values()));

    // Check graph-level timeout first — it is the root cause when tasks fail due
    // to the graph abort signal, and should take precedence over any task-level
    // TaskAbortedError that was placed in failedTaskErrors as a consequence.
    if (this.pendingGraphTimeoutError) {
      await this.handleAbort();
      throw this.pendingGraphTimeoutError;
    }
    if (this.failedTaskErrors.size > 0) {
      const latestError = this.failedTaskErrors.values().next().value!;
      this.handleError(latestError);
      throw latestError;
    }
    if (this.abortController?.signal.aborted) {
      await this.handleAbort();
      throw new TaskAbortedError();
    }

    await this.handleComplete();

    return this.filterLeafResults(results);
  }

  /**
   * Runs the task graph in preview mode
   * @param input Optional input to pass to root tasks (tasks with no incoming dataflows)
   * @param config Optional configuration for the preview run. Supports overriding the
   *   ServiceRegistry (`registry`), providing an output cache (`outputCache`), passing an
   *   abort signal (`parentSignal`), and controlling whether streaming leaf task outputs are
   *   accumulated into the return value (`accumulateLeafOutputs`).
   * @returns A promise that resolves when all tasks are complete
   * @throws TaskConfigurationError if the graph is already running in preview
   */
  public async runGraphPreview<Output extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config?: TaskGraphRunPreviewConfig
  ): Promise<GraphResultArray<Output>> {
    await this.handleStartPreview(config);

    // runPreview is on the UI preview hot path (fires per keystroke), so
    // instrumentation only runs when telemetry is enabled. Without the gate,
    // the four performance.now() calls per task and the per-run debug log
    // payload would burn cycles on every preview update.
    const telemetry = getTelemetryProvider();
    const telemetryEnabled = telemetry.isEnabled;
    const previewRunId = telemetryEnabled ? uuid4() : "";
    let previewSpan: ISpan | undefined;
    if (telemetryEnabled) {
      previewSpan = telemetry.startSpan("workglow.graph.runPreview", {
        attributes: {
          "workglow.graph.preview.run_id": previewRunId,
          "workglow.graph.task_count": this.graph.getTasks().length,
          "workglow.graph.dataflow_count": this.graph.getDataflows().length,
        },
      });
    }

    const t0 = telemetryEnabled ? performance.now() : 0;
    const taskTimings: Array<{
      id: unknown;
      type: string;
      runPreviewMs: number;
      pushOutputMs: number;
    }> = [];

    const results: GraphResultArray<Output> = [];
    try {
      for await (const task of this.previewScheduler.tasks()) {
        const isRootTask = this.graph.getSourceDataflows(task.id).length === 0;

        if (task.status === TaskStatus.PENDING) {
          task.resetInputData();
          this.copyInputFromEdgesToNode(task);
          // TODO: cacheable here??
          // if (task.cacheable) {
          //   const results = await this.outputCache?.getOutput(
          //     (task.constructor as any).type,
          //     task.runInputData
          //   );
          //   if (results) {
          //     task.runOutputData = results;
          //   }
          // }
        }

        // For root tasks (no incoming dataflows), apply the input parameter
        // This is important for GraphAsTask subgraphs where the InputTask needs
        // to receive the parent's input values
        const taskInput = isRootTask ? input : {};

        if (telemetryEnabled) {
          const taskType = String(
            (task.constructor as any).runtype || (task.constructor as typeof Task).type || "?"
          );
          const tPreview = performance.now();
          const taskResult = await task.runPreview(taskInput);
          const runPreviewMs = performance.now() - tPreview;
          const tPush = performance.now();
          await this.pushOutputFromNodeToEdges(task, taskResult);
          const pushOutputMs = performance.now() - tPush;
          taskTimings.push({ id: task.id, type: taskType, runPreviewMs, pushOutputMs });

          if (this.graph.getTargetDataflows(task.id).length === 0) {
            results.push({
              id: task.id,
              type: (task.constructor as any).runtype || (task.constructor as any).type,
              data: taskResult as Output,
            });
          }
        } else {
          const taskResult = await task.runPreview(taskInput);
          await this.pushOutputFromNodeToEdges(task, taskResult);

          if (this.graph.getTargetDataflows(task.id).length === 0) {
            results.push({
              id: task.id,
              type: (task.constructor as any).runtype || (task.constructor as any).type,
              data: taskResult as Output,
            });
          }
        }
      }
      await this.handleCompletePreview();

      if (previewSpan) {
        const totalMs = performance.now() - t0;
        previewSpan.setAttributes({
          "workglow.graph.preview.duration_ms": Math.round(totalMs * 1000) / 1000,
          "workglow.graph.preview.tasks_executed": taskTimings.length,
        });
        previewSpan.setStatus(SpanStatusCode.OK);
        previewSpan.end();
        getLogger().debug("task graph runPreview timings", {
          previewRunId,
          totalMs: Math.round(totalMs * 1000) / 1000,
          taskTimings,
        });
      }

      return this.filterLeafResults(results);
    } catch (error) {
      await this.handleErrorPreview();

      if (previewSpan) {
        const totalMs = performance.now() - t0;
        const message = error instanceof Error ? error.message : String(error);
        previewSpan.setAttributes({
          "workglow.graph.preview.duration_ms": Math.round(totalMs * 1000) / 1000,
          "workglow.graph.preview.tasks_executed": taskTimings.length,
        });
        previewSpan.setStatus(SpanStatusCode.ERROR, message);
        previewSpan.end();
        getLogger().debug("task graph runPreview failed", {
          previewRunId,
          totalMs: Math.round(totalMs * 1000) / 1000,
          taskTimings,
          error,
        });
      }

      throw error;
    }
  }

  /**
   * Aborts the task graph execution
   */
  public abort(): void {
    this.abortController?.abort();
  }

  /**
   * Disables the task graph execution
   */
  public async disable(): Promise<void> {
    await this.handleDisable();
  }

  /**
   * Filters graph-level input to only include properties that are not connected via dataflows for a given task
   * @param task The task to filter input for
   * @param input The graph-level input
   * @returns Filtered input containing only unconnected properties
   */
  protected filterInputForTask(task: ITask, input: TaskInput): TaskInput {
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
   * Adds input data to a task.
   * Delegates to {@link Task.addInput} for the actual merging logic.
   *
   * @param task The task to add input data to
   * @param overrides The input data to override (or add to if an array)
   */
  public addInputData(task: ITask, overrides: Partial<TaskInput> | undefined): void {
    if (!overrides) return;

    const changed = task.addInput(overrides);

    // TODO(str): This is a hack.
    if (changed && "regenerateGraph" in task && typeof task.regenerateGraph === "function") {
      task.regenerateGraph();
    }
  }

  // ========================================================================
  // Protected Handlers
  // ========================================================================

  /**
   * When leaf results include tasks with `isGraphOutput`, returns only those.
   * Otherwise returns all leaf results unchanged.
   */
  protected filterLeafResults<T>(results: GraphResultArray<T>): GraphResultArray<T> {
    if (results.length <= 1) return results;
    const graphOutputResults = results.filter((r) => {
      const task = this.graph.getTask(r.id);
      return task && (task.constructor as typeof Task).isGraphOutput;
    });
    return graphOutputResults.length > 0 ? graphOutputResults : results;
  }

  public mergeExecuteOutputsToRunOutput<
    ExecuteOutput extends TaskOutput,
    Merge extends CompoundMergeStrategy = CompoundMergeStrategy,
  >(
    results: GraphResultArray<ExecuteOutput>,
    compoundMerge: Merge
  ): GraphResult<ExecuteOutput, Merge> {
    if (compoundMerge === GRAPH_RESULT_ARRAY) {
      return results as GraphResult<ExecuteOutput, Merge>;
    }

    if (compoundMerge === PROPERTY_ARRAY) {
      let fixedOutput = {} as PropertyArrayGraphResult<ExecuteOutput>;
      const outputs = results.map((result: any) => result.data);
      if (outputs.length === 1) {
        fixedOutput = outputs[0];
      } else if (outputs.length > 1) {
        const collected = collectPropertyValues<ExecuteOutput>(outputs as ExecuteOutput[]);
        if (Object.keys(collected).length > 0) {
          fixedOutput = collected;
        }
      }
      return fixedOutput as GraphResult<ExecuteOutput, Merge>;
    }
    throw new TaskConfigurationError(`Unknown compound merge strategy: ${compoundMerge}`);
  }

  /**
   * Copies input data from edges to a task
   * @param task The task to copy input data to
   */
  protected copyInputFromEdgesToNode(task: ITask) {
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
      this.addInputData(task, portData);
    }
  }

  /**
   * Pushes the output of a task to its target tasks
   * @param node The task that produced the output
   * @param results The output of the task
   */
  protected async pushOutputFromNodeToEdges(node: ITask, results: TaskOutput) {
    const dataflows = this.graph.getTargetDataflows(node.id);

    // Preview-mode chain-head downscale: apply `previewSource` to any
    // image-shaped output before it's pushed downstream. This relocates the
    // per-task `executePreview` invocation of `previewSource` to the engine,
    // where it fires once per chain head and is idempotent on already-small
    // images (returns the input unchanged when within budget).
    if (this.previewRunning && Object.keys(results).length > 0) {
      for (const port of Object.keys(results)) {
        const value = (results as Record<string, unknown>)[port];
        if (isImageValueShape(value)) {
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
      const compatibility = dataflow.semanticallyCompatible(this.graph, dataflow, this.registry);
      if (compatibility === "static") {
        dataflow.setPortData(results);
        await dataflow.applyTransforms(this.registry);
      } else if (compatibility === "runtime") {
        const task = this.graph.getTask(dataflow.targetTaskId)!;
        const narrowed = await task.narrowInput({ ...results }, this.registry);
        dataflow.setPortData(narrowed);
        await dataflow.applyTransforms(this.registry);
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
   * Pushes the status of a task to its target edges
   * @param node The task that produced the status
   *
   * For ConditionalTask, this method handles selective dataflow status:
   * - Active branch dataflows get COMPLETED status
   * - Inactive branch dataflows get DISABLED status
   */
  protected pushStatusFromNodeToEdges(graph: TaskGraph, node: ITask, status?: TaskStatus): void {
    if (!node?.config?.id) return;

    const dataflows = graph.getTargetDataflows(node.id);
    const effectiveStatus = status ?? node.status;

    // Check if this is a ConditionalTask with selective branching
    if (node instanceof ConditionalTask && effectiveStatus === TaskStatus.COMPLETED) {
      // Build a map of output port -> branch ID for lookup
      const branches = node.config.branches ?? [];
      const portToBranch = new Map<string, string>();
      for (const branch of branches) {
        portToBranch.set(branch.outputPort, branch.id);
      }

      const activeBranches = node.getActiveBranches();

      for (const dataflow of dataflows) {
        // Preserve FAILED edges (e.g. transform chain failure) rather than
        // overwriting with the source task's completion status.
        if (dataflow.status === TaskStatus.FAILED) continue;
        const branchId = portToBranch.get(dataflow.sourceTaskPortId);
        if (branchId !== undefined) {
          // This dataflow is from a branch port
          if (activeBranches.has(branchId)) {
            // Branch is active - dataflow gets completed status
            dataflow.setStatus(TaskStatus.COMPLETED);
          } else {
            // Branch is inactive - dataflow gets disabled status
            dataflow.setStatus(TaskStatus.DISABLED);
          }
        } else {
          // Not a branch port (e.g., _activeBranches metadata) - use normal status
          dataflow.setStatus(effectiveStatus);
        }
      }

      // Cascade disabled status to downstream tasks
      this.propagateDisabledStatus(graph);
      return;
    }

    // Default behavior for non-conditional tasks
    dataflows.forEach((dataflow) => {
      // Preserve FAILED edges (e.g. transform chain failure) rather than
      // overwriting with the source task's completion status.
      if (dataflow.status === TaskStatus.FAILED) return;
      dataflow.setStatus(effectiveStatus);
    });
  }

  /**
   * Pushes the error of a task to its target edges
   * @param node The task that produced the error
   */
  protected pushErrorFromNodeToEdges(graph: TaskGraph, node: ITask): void {
    if (!node?.config?.id) return;
    graph.getTargetDataflows(node.id).forEach((dataflow) => {
      dataflow.error = node.error;
    });
  }

  /**
   * Returns true if the task has any outgoing dataflow edges that use the
   * error output port (`[error]`). These edges indicate that the task's
   * errors should be routed to downstream handler tasks instead of failing
   * the entire graph.
   */
  protected hasErrorOutputEdges(task: ITask): boolean {
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
  protected pushErrorOutputToEdges(task: ITask): void {
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
    this.propagateDisabledStatus(this.graph);
  }

  /**
   * Propagates DISABLED status through the graph.
   *
   * When a task's ALL incoming dataflows are DISABLED, that task becomes unreachable
   * and should also be disabled. This cascades through the graph until no more
   * tasks can be disabled.
   *
   * This is used by ConditionalTask to disable downstream tasks on inactive branches.
   *
   * @param graph The task graph to propagate disabled status through
   */
  protected propagateDisabledStatus(graph: TaskGraph): void {
    let changed = true;

    // Keep iterating until no more changes (fixed-point iteration)
    while (changed) {
      changed = false;

      for (const task of graph.getTasks()) {
        // Only consider tasks that are still pending
        if (task.status !== TaskStatus.PENDING) {
          continue;
        }

        const incomingDataflows = graph.getSourceDataflows(task.id);

        // Skip tasks with no incoming dataflows (root tasks)
        if (incomingDataflows.length === 0) {
          continue;
        }

        // Check if ALL incoming dataflows are DISABLED
        const allDisabled = incomingDataflows.every((df) => df.status === TaskStatus.DISABLED);

        if (allDisabled) {
          // This task is unreachable - disable it synchronously
          // Set status directly to avoid async issues
          task.status = TaskStatus.DISABLED;
          task.progress = 100;
          task.completedAt = new Date();
          task.emit("disabled");
          task.emit("status", task.status);

          // Propagate disabled status to its outgoing dataflows
          graph.getTargetDataflows(task.id).forEach((dataflow) => {
            dataflow.setStatus(TaskStatus.DISABLED);
          });

          // Mark as completed in scheduler so it doesn't wait for this task
          this.processScheduler.onTaskCompleted(task.id);

          changed = true;
        }
      }
    }
  }

  /**
   * Determines whether a streaming task needs to accumulate its text-delta
   * chunks into an enriched finish event. Accumulation is needed when:
   *
   * 1. Output caching is active (the cached value must be fully materialised).
   * 2. Any outgoing dataflow edge connects a streaming output port to an input
   *    port that is not streaming with the same mode (i.e. the downstream task
   *    cannot consume a raw stream and needs a completed value).
   *
   * When accumulation is required the source task runs with shouldAccumulate=true,
   * emitting an enriched finish event that carries all accumulated port text.
   * All downstream dataflow edges share that event via tee'd streams so no
   * edge needs to re-accumulate independently.
   */
  protected taskNeedsAccumulation(task: ITask): boolean {
    if (this.outputCache) return true;

    const outEdges = this.graph.getTargetDataflows(task.id);
    if (outEdges.length === 0) return this.accumulateLeafOutputs;

    const outSchema = task.outputSchema();

    for (const df of outEdges) {
      if (df.sourceTaskPortId === DATAFLOW_ALL_PORTS) {
        // Conservative: if any streaming output port exists, accumulate.
        // This covers the case where all-ports edges fan into non-streaming tasks.
        if (getStreamingPorts(outSchema).length > 0) return true;
        continue;
      }

      const targetTask = this.graph.getTask(df.targetTaskId);
      if (!targetTask) continue;
      const inSchema = targetTask.inputSchema();

      if (edgeNeedsAccumulation(outSchema, df.sourceTaskPortId, inSchema, df.targetTaskPortId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Runs a task
   * @param task The task to run
   * @param input The input for the task
   * @returns The output of the task
   */
  protected async runTask<T>(task: ITask, input: TaskInput): Promise<GraphSingleTaskResult<T>> {
    const isStreamable = isTaskStreamable(task);

    // For pass-through streaming tasks: if the task is streamable and has
    // streaming input edges, tee each stream so one copy is forwarded to
    // the task's executeStream() (via inputStreams) while the other stays
    // on the edge for materialization by awaitStreamInputs.
    if (isStreamable) {
      const dataflows = this.graph.getSourceDataflows(task.id);
      const streamingEdges = dataflows.filter((df) => df.stream !== undefined);
      if (streamingEdges.length > 0) {
        const inputStreams = new Map<string, ReadableStream<StreamEvent>>();
        for (const df of streamingEdges) {
          const stream = df.stream!;
          const [forwardCopy, materializeCopy] = stream.tee();
          inputStreams.set(df.targetTaskPortId, forwardCopy);
          df.setStream(materializeCopy);
        }
        task.runner.inputStreams = inputStreams;
      }
    }

    // Await any active streams on input dataflow edges so their values
    // are materialized before we read them. This applies to ALL downstream
    // tasks (both streaming and non-streaming) because copyInputFromEdgesToNode
    // reads via getPortData() which requires materialized values.
    // Streaming downstream tasks are still unblocked early by the scheduler
    // (they can start setup while upstream is streaming), but their actual
    // input data waits for upstream completion.
    await this.awaitStreamInputs(task);

    this.copyInputFromEdgesToNode(task);

    // Runtime entitlement enforcement for tasks with dynamic entitlements
    if (this.activeEnforcer && (task.constructor as typeof Task).hasDynamicEntitlements) {
      const denied = await this.activeEnforcer.checkTask(task);
      if (denied.length > 0) {
        throw new TaskEntitlementError(
          `Task ${(task.constructor as typeof Task).type} denied entitlements: ${denied.map(formatEntitlementDenial).join(", ")}`
        );
      }
    }

    if (isStreamable) {
      return this.runStreamingTask<T>(task, input);
    }

    const results = await task.runner.run(input, {
      // Pass `false` when no cache so TaskRunner.handleStart explicitly clears
      // its own cached reference (undefined would leave the old value intact).
      outputCache: this.outputCache ?? false,
      updateProgress: async (task: ITask, progress: number, message?: string, ...args: any[]) =>
        await this.handleProgress(task, progress, message, ...args),
      registry: this.registry,
      resourceScope: this.resourceScope,
    });

    await this.pushOutputFromNodeToEdges(task, results);

    return {
      id: task.id,
      type: (task.constructor as any).runtype || (task.constructor as any).type,
      data: results as T,
    };
  }

  /**
   * For non-streaming downstream tasks, awaits completion of any active
   * streams on input dataflow edges, materializing their values.
   *
   * Streaming upstream tasks set a ReadableStream on outgoing edges.
   * Non-streaming downstream tasks cannot consume streams directly, so
   * this method reads each stream to completion and accumulates the
   * value (via Dataflow.awaitStreamValue) before the task reads its
   * inputs through the normal getPortData() path.
   */
  protected async awaitStreamInputs(task: ITask): Promise<void> {
    const dataflows = this.graph.getSourceDataflows(task.id);
    const streamingDataflows = dataflows.filter((df) => df.stream !== undefined);
    if (streamingDataflows.length === 0) return;
    await Promise.all(
      streamingDataflows.map(async (df) => {
        await df.awaitStreamValue();
        // awaitStreamValue sets port data from the raw finish/snapshot event.
        // Apply the edge's transform chain over the materialised value so the
        // downstream task receives the transformed result. This is the sole
        // transform application for streaming edges (pushOutputFromNodeToEdges
        // deliberately skips them to avoid double-apply).
        await df.applyTransforms(this.registry);
      })
    );
  }

  /**
   * Runs a streaming task within the DAG.
   * Listens for stream events to:
   * - Notify the scheduler when streaming begins (unblocking downstream streamable tasks)
   * - Push stream data to outgoing dataflow edges
   * - Have the source task accumulate and emit enriched finish events for
   *   non-streaming downstream tasks (when taskNeedsAccumulation() is true)
   */
  protected async runStreamingTask<T>(
    task: ITask,
    input: TaskInput
  ): Promise<GraphSingleTaskResult<T>> {
    const streamMode = getOutputStreamMode(task.outputSchema());
    const shouldAccumulate = this.taskNeedsAccumulation(task);

    let streamingNotified = false;

    const onStatus = (status: TaskStatus) => {
      if (status === TaskStatus.STREAMING && !streamingNotified) {
        streamingNotified = true;
        this.pushStatusFromNodeToEdges(this.graph, task, TaskStatus.STREAMING);
        this.pushStreamToEdges(task, streamMode);
        this.processScheduler.onTaskStreaming(task.id);
      }
    };

    const onStreamStart = () => {
      this.graph.emit("task_stream_start", task.id);
    };

    const onStreamChunk = (event: StreamEvent) => {
      this.graph.emit("task_stream_chunk", task.id, event);
    };

    const onStreamEnd = (output: Record<string, any>) => {
      this.graph.emit("task_stream_end", task.id, output);
    };

    task.on("status", onStatus);
    task.on("stream_start", onStreamStart);
    task.on("stream_chunk", onStreamChunk);
    task.on("stream_end", onStreamEnd);

    try {
      const results = await task.runner.run(input, {
        outputCache: this.outputCache ?? false,
        shouldAccumulate,
        updateProgress: async (task: ITask, progress: number, message?: string, ...args: any[]) =>
          await this.handleProgress(task, progress, message, ...args),
        registry: this.registry,
        resourceScope: this.resourceScope,
      });

      await this.pushOutputFromNodeToEdges(task, results);

      return {
        id: task.id,
        type: (task.constructor as any).runtype || (task.constructor as any).type,
        data: results as T,
      };
    } finally {
      task.off("status", onStatus);
      task.off("stream_start", onStreamStart);
      task.off("stream_chunk", onStreamChunk);
      task.off("stream_end", onStreamEnd);
    }
  }

  /**
   * Returns true if an event carries a port-specific delta (text-delta or object-delta).
   */
  private static isPortDelta(event: StreamEvent): event is StreamEvent & { port: string } {
    return event.type === "text-delta" || event.type === "object-delta";
  }

  /**
   * Creates a ReadableStream from task streaming events, optionally filtered
   * to a single port. When `portId` is undefined (DATAFLOW_ALL_PORTS), all
   * events pass through. When set, only delta events matching the port plus
   * control events (finish, error, snapshot) are enqueued.
   *
   * Also taps snapshot events to write per-port data into each edge's
   * `latestSnapshot` slot for downstream peek-during-streaming.
   */
  private createStreamFromTaskEvents(
    task: ITask,
    portId: string | undefined,
    edgesForGroup: ReadonlyArray<Dataflow>,
  ): ReadableStream<StreamEvent> {
    return new ReadableStream<StreamEvent>({
      start: (controller) => {
        const onChunk = (event: StreamEvent) => {
          try {
            if (
              portId !== undefined &&
              TaskGraphRunner.isPortDelta(event) &&
              event.port !== portId
            ) {
              return;
            }
            // Tap: on snapshot events, write per-port data into each edge's
            // latestSnapshot slot.
            if (event.type === "snapshot") {
              const data = event.data as Record<string, unknown> | undefined;
              if (data) {
                for (const edge of edgesForGroup) {
                  const portValue =
                    edge.sourceTaskPortId === DATAFLOW_ALL_PORTS
                      ? data
                      : data[edge.sourceTaskPortId];
                  edge.latestSnapshot = portValue;
                }
              }
            }
            controller.enqueue(event);
          } catch {
            // Stream may be closed
          }
        };
        const onEnd = () => {
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
          task.off("stream_chunk", onChunk);
          task.off("stream_end", onEnd);
        };
        task.on("stream_chunk", onChunk);
        task.on("stream_end", onEnd);
      },
    });
  }

  /**
   * Pushes stream events from a streaming task to its outgoing dataflow edges.
   * Creates per-port filtered ReadableStreams for specific-port edges and
   * unfiltered streams for DATAFLOW_ALL_PORTS edges. Within each port group,
   * uses tee() for fan-out to multiple consumers.
   */
  protected pushStreamToEdges(task: ITask, _streamMode: StreamMode): void {
    const targetDataflows = this.graph.getTargetDataflows(task.id);
    if (targetDataflows.length === 0) return;

    // Group edges by their source port
    const groups = new Map<string, typeof targetDataflows>();
    for (const df of targetDataflows) {
      const key = df.sourceTaskPortId;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(df);
    }

    for (const [portKey, edges] of groups) {
      const filterPort = portKey === DATAFLOW_ALL_PORTS ? undefined : portKey;
      const stream = this.createStreamFromTaskEvents(task, filterPort, edges);

      if (edges.length === 1) {
        edges[0].setStream(stream);
      } else {
        let currentStream = stream;
        for (let i = 0; i < edges.length; i++) {
          if (i === edges.length - 1) {
            edges[i].setStream(currentStream);
          } else {
            const [s1, s2] = currentStream.tee();
            edges[i].setStream(s1);
            currentStream = s2;
          }
        }
      }
    }
  }

  /**
   * Resets a task
   * @param graph The task graph to reset
   * @param task The task to reset
   * @param runId The run ID
   */
  protected resetTask(graph: TaskGraph, task: ITask, runId: string) {
    task.status = TaskStatus.PENDING;
    task.resetInputData();
    task.runOutputData = {};
    task.error = undefined;
    task.progress = 0;
    task.runConfig = { ...task.runConfig, runnerId: runId };
    this.pushStatusFromNodeToEdges(graph, task);
    this.pushErrorFromNodeToEdges(graph, task);
    task.emit("reset");
    task.emit("status", task.status);
  }

  /**
   * Resets the task graph, recursively
   * @param graph The task graph to reset
   */
  public resetGraph(graph: TaskGraph, runnerId: string) {
    graph.getTasks().forEach((node) => {
      this.resetTask(graph, node, runnerId);
      node.regenerateGraph();
      if (node.hasChildren()) {
        this.resetGraph(node.subGraph, runnerId);
      }
    });
    graph.getDataflows().forEach((dataflow) => {
      dataflow.reset();
    });
  }

  /**
   * Handles the start of task graph execution
   * @param parentSignal Optional abort signal from parent
   */
  protected async handleStart(config?: TaskGraphRunConfig): Promise<void> {
    // Setup registry - create child from global if not provided
    if (config?.registry !== undefined) {
      this.registry = config.registry;
    } else if (this.registry === undefined) {
      // Create a child container that inherits from global but allows overrides
      this.registry = new ServiceRegistry(globalServiceRegistry.container.createChildContainer());
    }
    if (config?.resourceScope !== undefined) {
      this.resourceScope = config.resourceScope;
    }

    this.accumulateLeafOutputs = config?.accumulateLeafOutputs !== false;

    if (config?.outputCache !== undefined) {
      if (typeof config.outputCache === "boolean") {
        if (config.outputCache === true) {
          this.outputCache = this.registry.get(TASK_OUTPUT_REPOSITORY);
        } else {
          this.outputCache = undefined;
        }
      } else {
        this.outputCache = config.outputCache;
      }
      this.graph.outputCache = this.outputCache;
    }

    // Prevent reentrancy
    if (this.running || this.previewRunning) {
      throw new TaskConfigurationError("Graph is already running");
    }

    this.running = true;
    this.abortController = new AbortController();
    this.abortController.signal.addEventListener("abort", () => {
      this.handleAbort();
    });

    // Set up graph-level timeout if configured
    if (config?.timeout !== undefined && config.timeout > 0) {
      this.pendingGraphTimeoutError = undefined;
      this.graphTimeoutTimer = setTimeout(() => {
        this.pendingGraphTimeoutError = new TaskGraphTimeoutError(config.timeout);
        this.abortController?.abort();
      }, config.timeout);
    }

    // Listen first, then check — addEventListener on an already-aborted signal
    // does not fire, so checking .aborted after ensures we never miss an abort.
    if (config?.parentSignal) {
      const onParentAbort = () => {
        this.abortController?.abort();
      };
      config.parentSignal.addEventListener("abort", onParentAbort, { once: true });
      if (config.parentSignal.aborted) {
        config.parentSignal.removeEventListener("abort", onParentAbort);
        this.abortController.abort();
        return;
      }
    }

    this.runId = uuid4();
    this.resetGraph(this.graph, this.runId); // Reset graph and regenerate sub-graphs, changes task count / entitlements
    this.processScheduler.reset();
    this.inProgressTasks.clear();
    this.inProgressFunctions.clear();
    this.failedTaskErrors.clear();

    // Validate and enforce after resetGraph (which regenerates sub-graphs and may
    // change task count / entitlements). On failure, clean up running state so the
    // runner remains reusable.
    try {
      // Validate graph size limits
      if (config?.maxTasks !== undefined && config.maxTasks > 0) {
        const taskCount = this.graph.getTasks().length;
        if (taskCount > config.maxTasks) {
          throw new TaskConfigurationError(
            `Graph has ${taskCount} tasks, exceeding the limit of ${config.maxTasks}`
          );
        }
      }

      // Opt-in entitlement enforcement (preflight)
      if (config?.enforceEntitlements) {
        if (!this.registry.has(ENTITLEMENT_ENFORCER)) {
          throw new TaskConfigurationError(
            "enforceEntitlements is enabled but no IEntitlementEnforcer is registered. " +
              "Register an enforcer via ENTITLEMENT_ENFORCER before running the graph."
          );
        }
        const enforcer = this.registry.get(ENTITLEMENT_ENFORCER);
        const denied = await enforcer.checkAll(computeGraphEntitlements(this.graph));
        if (denied.length > 0) {
          throw new TaskEntitlementError(
            `Denied entitlements: ${denied.map(formatEntitlementDenial).join(", ")}`
          );
        }
        this.activeEnforcer = enforcer;
      } else {
        this.activeEnforcer = undefined;
      }
    } catch (err) {
      // Reset running state so the runner is reusable after validation failures
      if (this.graphTimeoutTimer !== undefined) {
        clearTimeout(this.graphTimeoutTimer);
        this.graphTimeoutTimer = undefined;
      }
      this.abortController = undefined;
      this.activeEnforcer = undefined;
      this.running = false;
      throw err;
    }

    // Start telemetry span for the graph run
    const telemetry = getTelemetryProvider();
    if (telemetry.isEnabled) {
      this.telemetrySpan = telemetry.startSpan("workglow.graph.run", {
        attributes: {
          "workglow.graph.run_id": this.runId,
          "workglow.graph.task_count": this.graph.getTasks().length,
          "workglow.graph.dataflow_count": this.graph.getDataflows().length,
        },
      });
    }

    this.graph.emit("start");
  }

  protected async handleStartPreview(config?: TaskGraphRunConfig): Promise<void> {
    if (this.previewRunning) {
      throw new TaskConfigurationError("Graph is already running in preview");
    }

    // Use explicit registry if provided; otherwise keep the existing one
    // (which is either globalServiceRegistry by default, or whatever handleStart set).
    if (config?.registry !== undefined) {
      this.registry = config.registry;
    }

    // Validate graph size limits (same as handleStart)
    if (config?.maxTasks !== undefined && config.maxTasks > 0) {
      const taskCount = this.graph.getTasks().length;
      if (taskCount > config.maxTasks) {
        throw new TaskConfigurationError(
          `Graph has ${taskCount} tasks, exceeding the limit of ${config.maxTasks}`
        );
      }
    }

    // Note: `timeout` is not enforced for preview runs. Preview execution is
    // event-driven with no single completion point, so a graph-level timeout
    // does not apply. Use per-task timeouts for individual task time limits.

    this.previewScheduler.reset();
    this.previewRunning = true;
  }

  /**
   * Handles the completion of task graph execution
   */
  /**
   * Clears the graph-level timeout timer if active.
   */
  protected clearGraphTimeout(): void {
    if (this.graphTimeoutTimer !== undefined) {
      clearTimeout(this.graphTimeoutTimer);
      this.graphTimeoutTimer = undefined;
    }
  }

  protected async handleComplete(): Promise<void> {
    this.clearGraphTimeout();
    this.running = false;
    this.activeEnforcer = undefined;

    if (this.telemetrySpan) {
      this.telemetrySpan.setStatus(SpanStatusCode.OK);
      this.telemetrySpan.end();
      this.telemetrySpan = undefined;
    }

    this.graph.emit("complete");
  }

  protected async handleCompletePreview(): Promise<void> {
    this.previewRunning = false;
  }

  /**
   * Handles errors during task graph execution
   */
  protected async handleError(error: TaskError): Promise<void> {
    this.clearGraphTimeout();
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.STREAMING) {
          return task.abort();
        }
      })
    );
    this.running = false;
    this.activeEnforcer = undefined;

    if (this.telemetrySpan) {
      this.telemetrySpan.setStatus(SpanStatusCode.ERROR, error.message);
      this.telemetrySpan.setAttributes({ "workglow.graph.error": error.message });
      this.telemetrySpan.end();
      this.telemetrySpan = undefined;
    }

    this.graph.emit("error", error);
  }

  protected async handleErrorPreview(): Promise<void> {
    this.previewRunning = false;
  }

  /**
   * Handles task graph abortion
   */
  protected async handleAbort(): Promise<void> {
    this.clearGraphTimeout();
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.STREAMING) {
          return task.abort();
        }
      })
    );
    this.running = false;
    this.activeEnforcer = undefined;

    if (this.telemetrySpan) {
      this.telemetrySpan.setStatus(SpanStatusCode.ERROR, "aborted");
      this.telemetrySpan.addEvent("workglow.graph.aborted");
      this.telemetrySpan.end();
      this.telemetrySpan = undefined;
    }

    this.graph.emit("abort");
  }

  protected async handleAbortPreview(): Promise<void> {
    this.previewRunning = false;
  }

  /**
   * Handles task graph disabling
   */
  protected async handleDisable(): Promise<void> {
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PENDING) {
          return task.disable();
        }
      })
    );
    this.running = false;
    this.graph.emit("disabled");
  }

  /**
   * Handles progress updates for the task graph by averaging `progress` across tasks whose class
   * declares its own `execute` ({@link taskPrototypeHasOwnExecute}). Other nodes are ignored.
   * @param progress Progress value (0-100)
   * @param message Optional message
   * @param args Additional arguments
   */
  protected async handleProgress(
    task: ITask,
    progress: number,
    message?: string,
    ...args: any[]
  ): Promise<void> {
    const contributors = this.graph.getTasks().filter(taskPrototypeHasOwnExecute);
    if (contributors.length > 1) {
      const sum = contributors.reduce((acc, t) => acc + t.progress, 0);
      progress = Math.round(sum / contributors.length);
    } else if (contributors.length === 1) {
      const [only] = contributors;
      progress = only.progress;
    }
    this.pushStatusFromNodeToEdges(this.graph, task);
    // Emit aggregate progress before awaiting output push so UIs (and task `emit("progress")` in
    // TaskRunner) are not blocked when pushOutput/narrowInput is slow or stalls mid-run.
    this.graph.emit("graph_progress", progress, message, args);
    // Only push output when the task has produced data; progress can fire mid-run with empty runOutputData
    if (task.runOutputData && Object.keys(task.runOutputData).length > 0) {
      await this.pushOutputFromNodeToEdges(task, task.runOutputData);
    }
  }
}
