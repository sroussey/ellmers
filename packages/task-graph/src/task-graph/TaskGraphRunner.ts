/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConvertAllToOptionalArray, ISpan } from "@workglow/util";
import {
  collectPropertyValues,
  getLogger,
  getTelemetryProvider,
  globalServiceRegistry,
  ResourceScope,
  ServiceRegistry,
  SpanStatusCode,
  uuid4,
} from "@workglow/util";
import { CACHE_REGISTRY, DefaultCacheRegistry } from "../cache/CacheRegistry";
import { RunPrivateCacheRepo } from "../cache/RunPrivateCacheRepo";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";
import { TASK_OUTPUT_REPOSITORY } from "../storage/TaskOutputRepository";
import { ENTITLEMENT_ENFORCER, formatEntitlementDenial } from "../task/EntitlementEnforcer";
import type { ITask } from "../task/ITask";
import type { Usage } from "../task/StreamTypes";
import { isStreamConsumer, isTaskStreamable } from "../task/StreamTypes";
import { Task } from "../task/Task";
import type { TaskError } from "../task/TaskError";
import { TaskAbortedError, TaskConfigurationError, TaskEntitlementError } from "../task/TaskError";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskStatus } from "../task/TaskTypes";
import { EdgeMaterializer } from "./EdgeMaterializer";
import { computeGraphEntitlements, withStaticInputProjection } from "./GraphEntitlementUtils";
import { RunContext } from "./RunContext";
import { RunScheduler } from "./RunScheduler";
import { StreamPump } from "./StreamPump";
import type { TaskGraph, TaskGraphRunConfig, TaskGraphRunPreviewConfig } from "./TaskGraph";
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
  type: string;
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
  protected running = false;
  /**
   * Whether the task graph is currently running in preview mode.
   * Read by EdgeMaterializer via bracket access (`runner["previewRunning"]`).
   */
  protected previewRunning = false;

  public readonly graph: TaskGraph;

  protected outputCache?: TaskOutputRepository;

  /**
   * True when the caller explicitly passed `outputCache: false` in the run
   * config, meaning all caching (including CACHE_REGISTRY-based routing) should
   * be suppressed. Distinct from `this.outputCache === undefined`, which just
   * means no legacy repo was configured (CACHE_REGISTRY may still apply).
   */
  protected legacyCacheExplicitlyDisabled: boolean = false;

  /**
   * Whether leaf tasks (no outgoing edges) should accumulate their streaming
   * output. True by default so workflow return values are complete.
   */
  protected accumulateLeafOutputs: boolean = true;

  /**
   * Opt-in to the no-accumulation passthrough path for this run. Off by
   * default — every edge takes today's drain unless this is set AND the edge
   * meets the passthrough conditions (see {@link TaskGraphRunConfig.noAccumulation}).
   */
  protected noAccumulation: boolean = false;

  /** High-water mark (bytes) for the no-accumulation passthrough gate. */
  protected streamHighWaterBytes?: number;

  /** Liveness watchdog (ms) for the no-accumulation passthrough gate. */
  protected streamGateWatchdogMs?: number;

  /**
   * Service registry for this graph run.
   * Read by EdgeMaterializer via bracket access (`runner["registry"]`).
   */
  protected registry: ServiceRegistry = globalServiceRegistry;

  protected resourceScope?: ResourceScope;

  /**
   * Where a late charge from a task in this run lands. Installed by
   * handleStart, inheriting an outer run's sink when this is a subgraph run.
   */
  protected lateUsageSink?: (taskId: string, usage: Usage, modelId: string | undefined) => void;
  protected usageSink?: (taskId: string, usage: Usage, modelId: string | undefined) => void;
  protected usageRetireSink?: (taskId: string) => void;

  /**
   * Per-run state. Set by handleStart, cleared by handleComplete/Error/Abort.
   * The only mutable per-run state on the facade — exists so the public abort()
   * and disable() methods (which take no arguments) have something to act on.
   */
  protected currentCtx?: RunContext;

  /**
   * Stable identifier for the current graph run. Threaded from
   * {@link TaskGraphRunConfig.runId} through handleStart so that each
   * per-task run call carries the same identifier.
   */
  protected runId?: string;

  /**
   * Run-private cache wrapper for the current run. Set by handleStart when a
   * runId and private cache slot are both present; cleared at the end of each
   * run. Used to fire-and-forget clearRun() after a successful run.
   */
  protected currentRunPrivate?: RunPrivateCacheRepo;
  protected baseRegistryForRun?: ServiceRegistry;

  /**
   * Unsubscribes everything the current run installed to feed
   * {@link TaskGraph.usageAggregator}. The graph's event emitter outlives a
   * single run, so handleStart tears down the previous run's set before
   * installing a fresh one — otherwise re-running the same graph instance
   * would accumulate one duplicate set per run.
   *
   * Wider than {@link offLiveUsageSubscriptions}: the aggregator's retire
   * listener deliberately outlives the settle, so only the next run's start
   * can detach it.
   */
  protected offGraphUsageSubscriptions?: () => void;

  /**
   * Unsubscribes just the `task_usage` / `task_complete` pair — the listeners
   * that must not survive {@link settleRunUsage}, since a cumulative snapshot
   * folding in after the freeze would contradict `graph.runUsage`.
   */
  protected offLiveUsageSubscriptions?: () => void;

  /** True once {@link settleRunUsage} has frozen `graph.runUsage` for this run. */
  protected runUsageSettled = false;

  /**
   * Registry to restore after a preview run completes. Captured in
   * handleStartPreview when a preview installs its own registry, and restored in
   * handleCompletePreview/handleErrorPreview/handleAbortPreview so a preview's
   * registry never leaks into a subsequent run() that omits an explicit registry.
   */
  protected basePreviewRegistry?: ServiceRegistry;

  protected readonly edgeMaterializer: EdgeMaterializer;

  protected readonly streamPump: StreamPump;

  /**
   * Read by EdgeMaterializer via bracket access (`runner["runScheduler"]`).
   */
  protected readonly runScheduler: RunScheduler;

  constructor(
    graph: TaskGraph,
    outputCache?: TaskOutputRepository,
    protected processScheduler = new DependencyBasedScheduler(graph),
    protected previewScheduler = new TopologicalScheduler(graph)
  ) {
    this.graph = graph;
    // Wire the constructor cache into both the runner (used by runTask) and the
    // graph. Without `this.outputCache = outputCache`, a runner constructed as
    // `new TaskGraphRunner(graph, cache).runGraph()` would silently never cache
    // because runTask reads `this.outputCache`, not `graph.outputCache`.
    this.outputCache = outputCache;
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
    const ownsScope = config?.resourceScope === undefined;
    const effectiveConfig: TaskGraphRunConfig = ownsScope
      ? {
          ...config,
          resourceScope: new ResourceScope({ strategy: config?.disposeStrategy }),
        }
      : config!;

    try {
      await this.handleStart(effectiveConfig, input as Readonly<Record<string, unknown>>);

      // Capture ctx locally — terminal handlers (handleAbort/Error/Complete)
      // clear this.currentCtx, but the abort signal listener may invoke
      // handleAbort while runGraph's loop or epilogue is still running.
      // The local reference keeps per-run state readable until runGraph returns.
      const ctx = this.currentCtx!;

      const results = await this.runScheduler.runLoop<ExecuteOutput>(
        input,
        effectiveConfig,
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
        await this.handleError(latestError);
        throw latestError;
      }
      if (ctx.abortController.signal.aborted) {
        await this.handleAbort();
        throw new TaskAbortedError();
      }

      await this.handleComplete();

      // Await cleanup of run-private cache entries so that a same-runId restart
      // immediately after this call cannot race against deletions.
      const runPrivateToClean = this.currentRunPrivate;
      this.currentRunPrivate = undefined;
      if (runPrivateToClean) {
        try {
          await runPrivateToClean.clearRun();
        } catch (e) {
          getLogger().warn("RunPrivateCacheRepo.clearRun failed", { error: e });
        }
      }

      return this.filterLeafResults(results);
    } finally {
      if (ownsScope) {
        await effectiveConfig.resourceScope!.runComplete();
        // Only clear our auto-created reference. Caller-passed scopes keep the
        // caller's lifecycle; `handleStart` overwrites the field on the next
        // run anyway via `effectiveConfig`.
        this.resourceScope = undefined;
      }
    }
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

        // COMPLETED tasks have locked outputs and must not be re-previewed:
        // re-running preview could clobber the real result and overwrite the
        // data already pushed onto downstream edges. Forward the existing
        // output so dependents observe it, record it if this is a leaf, then
        // skip the preview for this task.
        if (task.status === TaskStatus.COMPLETED) {
          await this.edgeMaterializer.pushOutputFromNodeToEdges(task, task.runOutputData);
          if (this.graph.getTargetDataflows(task.id).length === 0) {
            results.push({
              id: task.id,
              type: (task.constructor as any).runtype || (task.constructor as any).type,
              data: task.runOutputData as Output,
            });
          }
          continue;
        }

        if (task.status === TaskStatus.PENDING) {
          task.resetInputData();
          this.edgeMaterializer.copyInputFromEdgesToNode(task);
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

  public abort(): void {
    this.currentCtx?.abortController.abort();
  }

  public async disable(): Promise<void> {
    await this.handleDisable();
  }

  /**
   * Adds input data to a task. Delegates to {@link Task.addInput} for the
   * actual merging logic.
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

  protected async runTask<T>(task: ITask, input: TaskInput): Promise<GraphSingleTaskResult<T>> {
    const isStreamable = isTaskStreamable(task);
    const isConsumer = isStreamConsumer(task);

    // For pass-through streaming tasks: if the task is streamable and has
    // streaming input edges, tee each stream so one copy is forwarded to
    // the task's executeStream() (via inputStreams) while the other stays
    // on the edge for materialization by awaitStreamInputs. A pure sink
    // (streams in, summary out) needs the same forwarding.
    if (isStreamable || isConsumer) {
      this.streamPump.prepareStreamingInputs(task, this.noAccumulation);
    }

    // Await any active streams on input dataflow edges so their values
    // are materialized before we read them. This applies to ALL downstream
    // tasks (both streaming and non-streaming) because copyInputFromEdgesToNode
    // reads via getPortData() which requires materialized values.
    // Streaming downstream tasks are still unblocked early by the scheduler
    // (they can start setup while upstream is streaming), but their actual
    // input data waits for upstream completion.
    await this.streamPump.awaitStreamInputs(task, this.registry, this.noAccumulation);

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

    // Anything that runs `executeStream()` goes through the pump — the same
    // pair that decided the input preparation above. A pure sink (delta-mode
    // input port, `executeStream`, no streaming output port) still streams: it
    // just streams inward. Dispatching it to `runner.run` instead left it
    // running its stream with none of the graph-level wiring the pump owns —
    // no `task_stream_start` / `_chunk` / `_end` on the graph, no STREAMING
    // status pushed to its edges, and no `taskNeedsAccumulation` decision
    // (`accumulateLeafOutputs` was never consulted for it). Its output ports
    // are non-streaming, so the pump's own output-side work — the passthrough
    // edge gates, the per-port stream fan-out — finds nothing to do and costs
    // nothing.
    if (isStreamable || isConsumer) {
      return this.streamPump.runStreamingTask<T>(task, input, this.currentCtx!, {
        registry: this.registry,
        outputCache: this.outputCache,
        resourceScope: this.resourceScope,
        lateUsageSink: this.lateUsageSink,
        usageSink: this.usageSink,
        usageRetireSink: this.usageRetireSink,
        accumulateLeafOutputs: this.accumulateLeafOutputs,
        noAccumulation: this.noAccumulation,
        streamHighWaterBytes: this.streamHighWaterBytes,
        streamGateWatchdogMs: this.streamGateWatchdogMs,
        updateProgress: (t, p, m, ...a) =>
          this.runScheduler.handleProgress(this.currentCtx!, t, p, m, ...a),
        runId: this.runId,
        legacyCacheExplicitlyDisabled: this.legacyCacheExplicitlyDisabled,
      });
    }

    const results = await task.runner.run(input, {
      // When caching was explicitly disabled (outputCache: false in run config),
      // pass `false` so TaskRunner clears any stale cacheRegistry. Otherwise pass
      // `this.outputCache` (which may be undefined, letting TaskRunner use
      // CACHE_REGISTRY from the per-run ServiceRegistry).
      outputCache: this.legacyCacheExplicitlyDisabled ? false : this.outputCache,
      // Thread stream-pacing options so a compound (subgraph-hosting) task
      // that takes the non-streaming path still retains and forwards them
      // into its subgraph run.
      noAccumulation: this.noAccumulation,
      streamHighWaterBytes: this.streamHighWaterBytes,
      streamGateWatchdogMs: this.streamGateWatchdogMs,
      updateProgress: async (
        task: ITask,
        progress: number | undefined,
        message?: string,
        ...args: any[]
      ) =>
        await this.runScheduler.handleProgress(this.currentCtx!, task, progress, message, ...args),
      registry: this.registry,
      resourceScope: this.resourceScope,
      lateUsageSink: this.lateUsageSink,
      usageSink: this.usageSink,
      usageRetireSink: this.usageRetireSink,
      runId: this.runId,
    });

    await this.edgeMaterializer.pushOutputFromNodeToEdges(task, results);

    return {
      id: task.id,
      type: (task.constructor as any).runtype || (task.constructor as any).type,
      data: results as T,
    };
  }

  /** Resets the task graph, recursively. */
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
   * Tracks private cache repos that have already received the durability warning,
   * keyed by the repo instance. WeakSet so a freshly constructed repo that is no
   * longer referenced is automatically eligible for re-warning if it shows up
   * again later. Static because routing is repo-instance scoped, not runner
   * scoped — a process can have one durable repo and many `TaskGraphRunner`s.
   */
  private static __durabilityWarnedRepos = new WeakSet<object>();

  /**
   * Conservative two-tier detector that decides whether a graph may route any
   * task to the `private` cache slot. Used by both the durability warning and
   * the `runId`-required guard in {@link handleStart}.
   *
   * 1. Read the static `cachePolicy` off the task's constructor. If `kind` is
   *    "private", the task is definitely private.
   * 2. Otherwise, if the task overrides `getCachePolicy` (i.e. its prototype's
   *    method is not `Task.prototype.getCachePolicy`), conservatively treat it
   *    as potentially private — the override may decide based on inputs that
   *    are not available at graph-start time.
   *
   * Note: probing `getCachePolicy({} as any)` is unsafe because input-dependent
   * overrides can throw or return the wrong branch when given empty inputs.
   */
  public static graphUsesPrivatePolicy(graph: TaskGraph): boolean {
    return graph.getTasks().some((t) => {
      const ctor = t.constructor as typeof Task;
      if (ctor.cachePolicy?.kind === "private") return true;
      // Override detection: prototype method differs from Task.prototype's.
      const proto = ctor.prototype as { getCachePolicy?: unknown };
      if (
        typeof proto.getCachePolicy === "function" &&
        proto.getCachePolicy !== Task.prototype.getCachePolicy
      ) {
        return true;
      }
      return false;
    });
  }

  protected async handleStart(
    config?: TaskGraphRunConfig,
    runInput?: Readonly<Record<string, unknown>>
  ): Promise<void> {
    // Setup registry — create child from global if not provided
    if (config?.registry !== undefined) {
      this.registry = config.registry;
    } else if (this.registry === undefined) {
      this.registry = new ServiceRegistry(globalServiceRegistry.container.createChildContainer());
    }
    if (config?.resourceScope !== undefined) {
      this.resourceScope = config.resourceScope;
    }
    // Inherit the outer run's sink when one was passed (a subgraph run), so a
    // nested task's late charge reaches the root run's aggregator rather than
    // an inner aggregator whose run is already over.
    this.lateUsageSink =
      config?.lateUsageSink ??
      ((taskId, usage, modelId) => this.graph.usageAggregator.chargeLate(taskId, usage, modelId));
    // Owned children (`context.own` + `child.run()`) are not scheduled here, so
    // their `usage` events never become `task_usage` unless a sink publishes
    // them. Reuse the same event the scheduler emits for graph-hosted tasks so
    // the aggregator / `graph_usage` path below stays the single observe site.
    this.usageSink =
      config?.usageSink ??
      ((taskId, usage, modelId) => {
        try {
          this.graph.emit("task_usage", taskId, usage, modelId);
        } catch (err) {
          getLogger().error("usage sink threw", { taskId, error: err });
        }
      });
    // Retire without emitting `task_complete`: that event has other listeners
    // (CLI completion tracking, bridges) that should not see owned children as
    // top-level graph tasks. The aggregator's retire is the whole contract.
    this.usageRetireSink =
      config?.usageRetireSink ?? ((taskId) => this.graph.usageAggregator.retire(String(taskId)));
    this.baseRegistryForRun = this.registry;

    // Store run identifier for per-task propagation.
    this.runId = config?.runId;

    // Warn once per non-durable private repo (across runs) when at least one
    // task in the graph routes to the private slot. This catches the
    // dev-mode-in-production misconfiguration where an in-memory store is wired
    // for convenience but restart-survival is expected. Rate-limited via a
    // WeakSet keyed by the repo instance so repeated `runGraph` calls against
    // the same registry do not flood the log.
    if (this.registry.has(CACHE_REGISTRY)) {
      const checkRegistry = this.registry.get(CACHE_REGISTRY);
      if (checkRegistry.private && !checkRegistry.private.isDurable()) {
        if (TaskGraphRunner.graphUsesPrivatePolicy(this.graph)) {
          const repo = checkRegistry.private as object;
          if (!TaskGraphRunner.__durabilityWarnedRepos.has(repo)) {
            TaskGraphRunner.__durabilityWarnedRepos.add(repo);
            getLogger().warn(
              "TaskGraphRunner: private cache repo may be used but is non-durable — " +
                "restart-survival will not work. Ensure the CacheRegistry 'private' " +
                "slot is backed by a durable storage backend."
            );
          }
        }
      }

      // Strict guard: if the graph contains a private-policy task but no runId
      // was provided, we cannot namespace writes — they would land directly in
      // the shared private repo and collide across runs. TaskGraphRunner is the
      // documented owner of runId, so this is a configuration error.
      if (!this.runId && checkRegistry.private) {
        if (TaskGraphRunner.graphUsesPrivatePolicy(this.graph)) {
          throw new TaskConfigurationError(
            "TaskGraphRunner: graph contains a private-policy task but no runId was provided. " +
              "Provide `runId` in TaskGraphRunConfig so private cache entries can be namespaced."
          );
        }
      }
    }

    // If there is a private cache slot and a runId, wrap the private slot in a
    // RunPrivateCacheRepo so all tasks in this run see a namespaced view of the
    // backing store. Build a child ServiceRegistry that overrides CACHE_REGISTRY
    // for this run only; the parent registry is unchanged.
    if (this.runId && this.registry.has(CACHE_REGISTRY)) {
      const baseRegistry = this.registry.get(CACHE_REGISTRY);
      if (baseRegistry.private) {
        const wrappedPrivate = new RunPrivateCacheRepo({
          backing: baseRegistry.private,
          runId: this.runId,
        });
        // Retain a reference so runGraph can fire-and-forget clearRun() after success.
        this.currentRunPrivate = wrappedPrivate;
        const wrappedRegistry = new DefaultCacheRegistry({
          deterministic: baseRegistry.deterministic,
          private: wrappedPrivate,
        });
        const childContainer = this.registry.container.createChildContainer();
        const runtimeServices = new ServiceRegistry(childContainer);
        // Copy all registrations from parent into child, then override CACHE_REGISTRY.
        runtimeServices.registerInstance(CACHE_REGISTRY, wrappedRegistry);
        this.registry = runtimeServices;

        // Register a disposal marker in the resource scope so the run boundary is
        // documented and callers can attach connection-bearing disposers on the same key.
        this.resourceScope?.register(`cache:private:${this.runId}`, async () => {
          // intentionally empty — RunPrivateCacheRepo has no resources of its own
        });
      }
    }

    this.accumulateLeafOutputs = config?.accumulateLeafOutputs !== false;
    this.noAccumulation = config?.noAccumulation === true;
    this.streamHighWaterBytes = config?.streamHighWaterBytes;
    this.streamGateWatchdogMs = config?.streamGateWatchdogMs;

    if (config?.outputCache !== undefined) {
      if (typeof config.outputCache === "boolean") {
        if (config.outputCache === true) {
          this.outputCache = this.registry.get(TASK_OUTPUT_REPOSITORY);
          this.legacyCacheExplicitlyDisabled = false;
        } else {
          // outputCache: false — suppress all caching, including CACHE_REGISTRY.
          this.outputCache = undefined;
          this.legacyCacheExplicitlyDisabled = true;
        }
      } else {
        this.outputCache = config.outputCache;
        this.legacyCacheExplicitlyDisabled = false;
      }
      this.graph.outputCache = this.outputCache;
    } else {
      // No explicit outputCache in this run's config — preserve existing legacy
      // repo (if any) but do not disable CACHE_REGISTRY routing.
      this.legacyCacheExplicitlyDisabled = false;
    }

    // Prevent reentrancy
    if (this.running || this.previewRunning) {
      throw new TaskConfigurationError("Graph is already running");
    }

    this.running = true;

    // Build per-run context (handles abortController + parentSignal wiring).
    // Thread the caller-supplied runId so ctx.runId — which becomes each task's
    // runnerId via resetGraph — matches the id the caller uses for run-scoped
    // queue operations. Falls back to a fresh uuid when no runId was provided.
    const ctx = new RunContext(config?.parentSignal, this.runId);
    this.currentCtx = ctx;

    ctx.abortController.signal.addEventListener("abort", () => {
      this.handleAbort();
    });

    // Set up graph-level timeout if configured
    if (config?.timeout !== undefined) {
      this.runScheduler.armGraphTimeout(config.timeout, ctx);
    }

    // Notify the disposal strategy that a new run is starting. Inactivity
    // strategies clear any pending idle timers here, closing the race
    // window where a stale timer armed at the previous runComplete could
    // dispose a resource the new run is about to touch.
    if (this.resourceScope) {
      await this.resourceScope.runStart();
    }

    // Early-out if parent signal was already aborted (RunContext constructor
    // already aborted ctx.abortController in that case)
    if (ctx.abortController.signal.aborted) return;

    this.resetGraph(this.graph, ctx.runId);
    const enforcing = config?.enforceEntitlements === true;
    for (const task of this.graph.getTasks()) {
      task.runConfig = { ...task.runConfig, enforceEntitlements: enforcing };
    }
    this.processScheduler.reset();
    // (in-progress maps + failedTaskErrors start empty on a fresh RunContext)

    // Tear down the previous run's graph-level usage subscriptions (if this
    // graph instance is being re-run) before installing a fresh aggregator.
    this.offGraphUsageSubscriptions?.();
    this.offLiveUsageSubscriptions = undefined;
    this.runUsageSettled = false;
    this.graph.usageAggregator.reset();
    this.graph.runUsage = undefined;
    const offRetire = this.graph.usageAggregator.onRetire(() => {
      const total = this.graph.usageAggregator.total;
      if (!total) return;
      // A charge settled after the run (checkpoint storage, billed at
      // disposal) still belongs to this run's total, so re-freeze rather than
      // emit a `graph_usage` contradicting `graph.runUsage`.
      if (this.runUsageSettled) this.graph.runUsage = total;
      this.graph.emit("graph_usage", total);
    });

    const offTaskUsage = this.graph.subscribe("task_usage", (taskId, usage, modelId) => {
      this.graph.usageAggregator.observe(String(taskId), usage, modelId);
      const total = this.graph.usageAggregator.total;
      if (total) this.graph.emit("graph_usage", total);
    });
    const offTaskComplete = this.graph.subscribe("task_complete", (taskId) => {
      this.graph.usageAggregator.retire(String(taskId));
    });
    this.offLiveUsageSubscriptions = () => {
      offTaskUsage();
      offTaskComplete();
    };
    this.offGraphUsageSubscriptions = () => {
      this.offLiveUsageSubscriptions?.();
      this.offLiveUsageSubscriptions = undefined;
      offRetire();
    };

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
        const required = withStaticInputProjection(this.graph, runInput, () =>
          computeGraphEntitlements(this.graph)
        );
        const denied = await enforcer.checkAll(required);
        if (denied.length > 0) {
          throw new TaskEntitlementError(
            `Denied entitlements: ${denied.map(formatEntitlementDenial).join(", ")}`
          );
        }
        ctx.activeEnforcer = enforcer;
      }
    } catch (err) {
      this.runScheduler.clearGraphTimeout(ctx);
      ctx.dispose();
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
    // Reject if a real run() is in flight: preview and run drive the same shared
    // graph/edge state (Dataflow.value/status, task.runInputData), so overlap
    // produces torn reads and lets a preview clobber a live run's outputs.
    if (this.running || this.previewRunning) {
      throw new TaskConfigurationError("Graph is already running in preview");
    }

    // Use explicit registry if provided; otherwise keep the existing one
    // (which is either globalServiceRegistry by default, or whatever handleStart set).
    // Save the prior registry so it can be restored after the preview, preventing
    // a preview-supplied registry from leaking into later run() calls.
    if (config?.registry !== undefined) {
      this.basePreviewRegistry = this.registry;
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

  protected clearGraphTimeout(): void {
    if (this.currentCtx) {
      this.runScheduler.clearGraphTimeout(this.currentCtx);
    }
  }

  /**
   * Retire what is still live, freeze the run total, and detach this run's
   * live listeners.
   *
   * Only the `task_usage` / `task_complete` pair goes: a cumulative snapshot
   * arriving after the freeze would fold in and emit a `graph_usage`
   * contradicting `graph.runUsage`. The aggregator's retire listener stays,
   * because a checkpoint's storage charge is only known when the run's
   * ResourceScope disposes it — after this point — and it re-freezes
   * `graph.runUsage` when it lands. Order is load-bearing: the sweep's
   * retirements must fire the listener before the live pair goes.
   */
  protected settleRunUsage(): void {
    this.graph.usageAggregator.sweep();
    this.graph.runUsage = this.graph.usageAggregator.total;
    this.offLiveUsageSubscriptions?.();
    this.offLiveUsageSubscriptions = undefined;
    this.runUsageSettled = true;
  }

  protected async handleComplete(): Promise<void> {
    this.clearGraphTimeout();
    const ctx = this.currentCtx;
    this.running = false;

    if (ctx?.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.OK);
      ctx.telemetrySpan.end();
    }
    ctx?.dispose();
    this.currentCtx = undefined;
    if (this.baseRegistryForRun !== undefined) {
      this.registry = this.baseRegistryForRun;
      this.baseRegistryForRun = undefined;
    }

    this.settleRunUsage();

    this.graph.emit("complete");
  }

  protected async handleCompletePreview(): Promise<void> {
    this.restorePreviewRegistry();
    this.previewRunning = false;
  }

  /**
   * Restores the registry captured before a preview installed its own, so the
   * preview's registry does not persist into subsequent run() calls.
   */
  protected restorePreviewRegistry(): void {
    if (this.basePreviewRegistry !== undefined) {
      this.registry = this.basePreviewRegistry;
      this.basePreviewRegistry = undefined;
    }
  }

  protected async handleError(error: TaskError): Promise<void> {
    this.clearGraphTimeout();
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.STREAMING) {
          return task.abort();
        }
      })
    );
    // Do NOT clear run-private entries on failure — left for restart / janitor TTL sweep.
    this.currentRunPrivate = undefined;
    const ctx = this.currentCtx;
    this.running = false;

    if (ctx?.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.ERROR, error.message);
      ctx.telemetrySpan.setAttributes({ "workglow.graph.error": error.message });
      ctx.telemetrySpan.end();
    }
    ctx?.dispose();
    this.currentCtx = undefined;
    if (this.baseRegistryForRun !== undefined) {
      this.registry = this.baseRegistryForRun;
      this.baseRegistryForRun = undefined;
    }

    this.settleRunUsage();

    this.graph.emit("error", error);
  }

  protected async handleErrorPreview(): Promise<void> {
    this.restorePreviewRegistry();
    this.previewRunning = false;
  }

  /**
   * Handles task graph abortion.
   *
   * Single-fire: invoked from both the abort-signal listener installed in
   * `handleStart` and the `runGraph` epilogue when `signal.aborted`. Without
   * a guard, observers see two `"abort"` events for one logical abort. We
   * latch on `this.running` synchronously so the second caller is a no-op.
   */
  protected async handleAbort(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.clearGraphTimeout();
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PROCESSING || task.status === TaskStatus.STREAMING) {
          return task.abort();
        }
      })
    );
    // Do NOT clear run-private entries on abort — left for restart / janitor TTL sweep.
    this.currentRunPrivate = undefined;
    const ctx = this.currentCtx;

    if (ctx?.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.ERROR, "aborted");
      ctx.telemetrySpan.addEvent("workglow.graph.aborted");
      ctx.telemetrySpan.end();
    }
    ctx?.dispose();
    this.currentCtx = undefined;
    if (this.baseRegistryForRun !== undefined) {
      this.registry = this.baseRegistryForRun;
      this.baseRegistryForRun = undefined;
    }

    this.settleRunUsage();

    this.graph.emit("abort");
  }

  protected async handleAbortPreview(): Promise<void> {
    this.restorePreviewRegistry();
    this.previewRunning = false;
  }

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
