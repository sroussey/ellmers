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
import { TASK_OUTPUT_REPOSITORY, TaskOutputRepository } from "../storage/TaskOutputRepository";
import { ENTITLEMENT_ENFORCER, formatEntitlementDenial } from "../task/EntitlementEnforcer";
import { ITask } from "../task/ITask";
import { isTaskStreamable } from "../task/StreamTypes";
import { Task } from "../task/Task";
import {
  TaskAbortedError,
  TaskConfigurationError,
  TaskEntitlementError,
  TaskError,
} from "../task/TaskError";
import { TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { EdgeMaterializer } from "./EdgeMaterializer";
import { computeGraphEntitlements } from "./GraphEntitlementUtils";
import { RunContext } from "./RunContext";
import { RunScheduler } from "./RunScheduler";
import { StreamPump } from "./StreamPump";
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
 * Class for running a task graph
 * Manages the execution of tasks in a task graph, including caching
 */
export class TaskGraphRunner {
  /**
   * Whether the task graph is currently running
   */
  protected running = false;
  /**
   * @internal Exposed for `EdgeMaterializer` back-reference. May be re-tightened
   * once preview-mode signaling is moved off the facade.
   *
   * Whether the task graph is currently running in preview mode.
   */
  public previewRunning = false;

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
   * @internal Exposed for `EdgeMaterializer` back-reference. May be re-tightened
   * once dataflow transforms no longer require the registry through the facade.
   *
   * Service registry for this graph run.
   */
  public registry: ServiceRegistry = globalServiceRegistry;
  /**
   * Resource scope for this graph run
   */
  protected resourceScope?: ResourceScope;

  /**
   * Per-run state. Set by handleStart, cleared by handleComplete/Error/Abort.
   * The only mutable per-run state on the facade — exists so the public abort()
   * and disable() methods (which take no arguments) have something to act on.
   */
  protected currentCtx?: RunContext;

  /**
   * Edge materializer — owns dataflow read/write, transforms, and error-port routing.
   */
  protected readonly edgeMaterializer: EdgeMaterializer;

  /**
   * Stream pump — owns streaming-input handoff, streaming task execution, and
   * stream tee/fan-out to outgoing dataflow edges.
   */
  protected readonly streamPump: StreamPump;

  /**
   * @internal Exposed for `EdgeMaterializer` back-reference. EdgeMaterializer
   * calls `runner.runScheduler.{pushStatusFromNodeToEdges,propagateDisabledStatus}`.
   *
   * Run-loop coordinator — owns the for-await loop body, status push, disabled
   * cascade, progress aggregation, and graph-level timeout arm/clear.
   */
  public readonly runScheduler: RunScheduler;

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
    this.edgeMaterializer = new EdgeMaterializer(graph, this);
    this.streamPump = new StreamPump(graph, this.processScheduler, this.edgeMaterializer);
    this.runScheduler = new RunScheduler(graph, this.processScheduler, this);
    this.streamPump.setRunScheduler(this.runScheduler);
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  public async runGraph<ExecuteOutput extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config?: TaskGraphRunConfig
  ): Promise<GraphResultArray<ExecuteOutput>> {
    await this.handleStart(config);

    // Capture ctx locally — terminal handlers (handleAbort/Error/Complete)
    // clear this.currentCtx, but the abort signal listener may invoke
    // handleAbort while runGraph's loop or epilogue is still running.
    // The local reference keeps per-run state readable until runGraph returns.
    const ctx = this.currentCtx!;

    const results = await this.runScheduler.runLoop<ExecuteOutput>(
      input,
      config,
      ctx,
      this.edgeMaterializer
    );

    // Check graph-level timeout first — it is the root cause when tasks fail due
    // to the graph abort signal, and should take precedence over any task-level
    // TaskAbortedError that was placed in failedTaskErrors as a consequence.
    // Capture pendingGraphTimeoutError BEFORE calling handleAbort, which clears currentCtx.
    const pendingTimeout = ctx.pendingGraphTimeoutError;
    if (pendingTimeout) {
      await this.handleAbort();
      throw pendingTimeout;
    }
    if (ctx.failedTaskErrors.size > 0) {
      const latestError = ctx.failedTaskErrors.values().next().value!;
      this.handleError(latestError);
      throw latestError;
    }
    if (ctx.abortController.signal.aborted) {
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
          this.edgeMaterializer.copyInputFromEdgesToNode(task);
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
          await this.edgeMaterializer.pushOutputFromNodeToEdges(task, taskResult);
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
          await this.edgeMaterializer.pushOutputFromNodeToEdges(task, taskResult);

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
    this.currentCtx?.abortController.abort();
  }

  /**
   * Disables the task graph execution
   */
  public async disable(): Promise<void> {
    await this.handleDisable();
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
      this.streamPump.prepareStreamingInputs(task);
    }

    // Await any active streams on input dataflow edges so their values
    // are materialized before we read them. This applies to ALL downstream
    // tasks (both streaming and non-streaming) because copyInputFromEdgesToNode
    // reads via getPortData() which requires materialized values.
    // Streaming downstream tasks are still unblocked early by the scheduler
    // (they can start setup while upstream is streaming), but their actual
    // input data waits for upstream completion.
    await this.streamPump.awaitStreamInputs(task, this.registry);

    this.edgeMaterializer.copyInputFromEdgesToNode(task);

    // Runtime entitlement enforcement for tasks with dynamic entitlements
    if (
      this.currentCtx?.activeEnforcer &&
      (task.constructor as typeof Task).hasDynamicEntitlements
    ) {
      const denied = await this.currentCtx.activeEnforcer.checkTask(task);
      if (denied.length > 0) {
        throw new TaskEntitlementError(
          `Task ${(task.constructor as typeof Task).type} denied entitlements: ${denied.map(formatEntitlementDenial).join(", ")}`
        );
      }
    }

    if (isStreamable) {
      return this.streamPump.runStreamingTask<T>(task, input, this.currentCtx!, {
        registry: this.registry,
        outputCache: this.outputCache,
        resourceScope: this.resourceScope,
        accumulateLeafOutputs: this.accumulateLeafOutputs,
        updateProgress: (t, p, m, ...a) =>
          this.runScheduler.handleProgress(this.currentCtx!, t, p, m, ...a),
      });
    }

    const results = await task.runner.run(input, {
      // Pass `false` when no cache so TaskRunner.handleStart explicitly clears
      // its own cached reference (undefined would leave the old value intact).
      outputCache: this.outputCache ?? false,
      updateProgress: async (
        task: ITask,
        progress: number | undefined,
        message?: string,
        ...args: any[]
      ) => await this.runScheduler.handleProgress(this.currentCtx!, task, progress, message, ...args),
      registry: this.registry,
      resourceScope: this.resourceScope,
    });

    await this.edgeMaterializer.pushOutputFromNodeToEdges(task, results);

    return {
      id: task.id,
      type: (task.constructor as any).runtype || (task.constructor as any).type,
      data: results as T,
    };
  }

  /**
   * Resets the task graph, recursively
   * @param graph The task graph to reset
   */
  public resetGraph(graph: TaskGraph, runnerId: string) {
    graph.getTasks().forEach((node) => {
      this.edgeMaterializer.resetTask(graph, node, runnerId);
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
    // Setup registry — create child from global if not provided
    if (config?.registry !== undefined) {
      this.registry = config.registry;
    } else if (this.registry === undefined) {
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

    // Build per-run context (handles abortController + parentSignal wiring)
    const ctx = new RunContext(config?.parentSignal);
    this.currentCtx = ctx;

    ctx.abortController.signal.addEventListener("abort", () => {
      this.handleAbort();
    });

    // Set up graph-level timeout if configured
    if (config?.timeout !== undefined) {
      this.runScheduler.armGraphTimeout(config.timeout, ctx);
    }

    // Early-out if parent signal was already aborted (RunContext constructor
    // already aborted ctx.abortController in that case)
    if (ctx.abortController.signal.aborted) return;

    this.resetGraph(this.graph, ctx.runId);
    this.processScheduler.reset();
    // (in-progress maps + failedTaskErrors start empty on a fresh RunContext)

    try {
      if (config?.maxTasks !== undefined && config.maxTasks > 0) {
        const taskCount = this.graph.getTasks().length;
        if (taskCount > config.maxTasks) {
          throw new TaskConfigurationError(
            `Graph has ${taskCount} tasks, exceeding the limit of ${config.maxTasks}`
          );
        }
      }

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
        ctx.activeEnforcer = enforcer;
      }
    } catch (err) {
      this.runScheduler.clearGraphTimeout(ctx);
      this.currentCtx = undefined;
      this.running = false;
      throw err;
    }

    const telemetry = getTelemetryProvider();
    if (telemetry.isEnabled) {
      ctx.telemetrySpan = telemetry.startSpan("workglow.graph.run", {
        attributes: {
          "workglow.graph.run_id": ctx.runId,
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
    if (this.currentCtx) {
      this.runScheduler.clearGraphTimeout(this.currentCtx);
    }
  }

  protected async handleComplete(): Promise<void> {
    this.clearGraphTimeout();
    const ctx = this.currentCtx;
    this.running = false;

    if (ctx?.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.OK);
      ctx.telemetrySpan.end();
    }
    this.currentCtx = undefined;

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
    const ctx = this.currentCtx;
    this.running = false;

    if (ctx?.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.ERROR, error.message);
      ctx.telemetrySpan.setAttributes({ "workglow.graph.error": error.message });
      ctx.telemetrySpan.end();
    }
    this.currentCtx = undefined;

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
    const ctx = this.currentCtx;
    this.running = false;

    if (ctx?.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.ERROR, "aborted");
      ctx.telemetrySpan.addEvent("workglow.graph.aborted");
      ctx.telemetrySpan.end();
    }
    this.currentCtx = undefined;

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

}
