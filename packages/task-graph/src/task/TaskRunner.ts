/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import {
  getLogger,
  getTelemetryProvider,
  globalServiceRegistry,
  ResourceScope,
  SpanStatusCode,
} from "@workglow/util";
import { isCacheRef, resolveReferenceThreshold } from "../cache/CacheRef";
import type { CacheRegistry } from "../cache/CacheRegistry";
import { CACHE_REGISTRY, DefaultCacheRegistry } from "../cache/CacheRegistry";
import { streamRefViaBacking } from "../cache/resolveRef";
import { RunPrivateCacheRepo } from "../cache/RunPrivateCacheRepo";
import { getStreamPortCodec } from "../cache/streamCodec";
import { TASK_OUTPUT_REPOSITORY, TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { Taskish } from "../task-graph/Conversions";
import { ensureTask } from "../task-graph/Conversions";
import { CacheCoordinator } from "./CacheCoordinator";
import { resolveSchemaInputs, schemaHasFormatAnnotations } from "./InputResolver";
import type { IRunConfig, ITask } from "./ITask";
import type { ITaskRunner } from "./ITaskRunner";
import type { BinaryRefSink, StreamSink } from "./StreamProcessor";
import { StreamProcessor } from "./StreamProcessor";
import type { StreamEvent } from "./StreamTypes";
import {
  getBinaryPortFormat,
  getOutputStreamMode,
  getPortStreamMode,
  getStreamingPorts,
  isDeltaStreamMode,
  isTaskStreamable,
  portForcesStreamValidation,
} from "./StreamTypes";
import { Task } from "./Task";
import {
  TaskAbortedError,
  TaskConfigurationError,
  TaskError,
  TaskFailedError,
  TaskInvalidInputError,
  TaskTimeoutError,
} from "./TaskError";
import { TaskRunContext } from "./TaskRunContext";
import type { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";
import { TaskStatus } from "./TaskTypes";

/**
 * Type guard that checks whether a value is an ITask-like object with a mutable `runConfig`.
 */
function hasRunConfig(i: unknown): i is { runConfig: Partial<IRunConfig> } {
  return i !== null && typeof i === "object" && "runConfig" in (i as object);
}

/**
 * Whether `own` can record a value's wrapper against it. Everything `Taskish`
 * admits is WeakMap-keyable — a pipe function included, which `typeof === "object"`
 * alone would exclude, leaving its wrapper unnameable and so undisownable.
 */
function isOwnTrackable(i: unknown): i is object {
  return i !== null && (typeof i === "object" || typeof i === "function");
}

/**
 * Adapts the legacy single-binary-port sink map to the unified per-port
 * {@link StreamSink} shape: a binary-mode sink is exactly a
 * {@link BinaryRefSink} with its mode named.
 */
function wrapBinarySinks(
  sinks: ReadonlyMap<string, BinaryRefSink> | undefined
): ReadonlyMap<string, StreamSink> | undefined {
  if (!sinks) return undefined;
  const wrapped = new Map<string, StreamSink>();
  for (const [port, write] of sinks) wrapped.set(port, { mode: "binary", write });
  return wrapped;
}

/**
 * Responsible for running tasks
 * Manages the execution lifecycle of individual tasks
 */
export class TaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> implements ITaskRunner<Input, Output, Config> {
  protected running = false;
  protected previewRunning = false;

  public readonly task: ITask<Input, Output, Config>;

  /**
   * Per-run state. Set by handleStart, cleared by handleComplete / handleError /
   * handleAbort / handleDisable. The only mutable per-run state on the facade —
   * exists so the public abort() and disable() methods (which take no arguments)
   * have something to act on.
   */
  protected currentCtx?: TaskRunContext;

  /**
   * Output cache repository resolved per-run. Set when the caller passes
   * `outputCache: repo | true` through IRunConfig; the {@link cacheRegistry}
   * deterministic slot is synthesized from it. When `outputCache` is absent
   * and a CACHE_REGISTRY is registered, that is used instead.
   */
  protected outputCache?: TaskOutputRepository;

  /**
   * Per-run cache registry resolved in handleStart. Replaces the legacy
   * single-repo `outputCache` field as the primary cache routing mechanism.
   * Set from CACHE_REGISTRY in the ServiceRegistry, or synthesised from the
   * legacy `config.outputCache` repo shim.
   */
  protected cacheRegistry?: CacheRegistry;

  /**
   * Stream-pacing options resolved per-run in handleStart (run config over
   * `task.runConfig`). Retained on the runner — like {@link outputCache} — so
   * compound runners (GraphAsTask / Iterator / While / Fallback) can forward
   * them into their subgraph runs via {@link streamRunOptions}.
   */
  protected noAccumulation?: boolean;
  protected streamHighWaterBytes?: number;
  protected streamGateWatchdogMs?: number;

  /**
   * Cache coordinator for the task (key normalization, lookup, save).
   */
  protected readonly cacheCoordinator: CacheCoordinator<Input, Output>;

  /**
   * Stream processor for the task (handles executeStream() event loop).
   */
  protected readonly streamProcessor: StreamProcessor<Input, Output>;

  protected registry: ServiceRegistry = globalServiceRegistry;

  protected resourceScope?: ResourceScope;

  /**
   * True when `this.resourceScope` was auto-created by `run()` (caller did not
   * pass one in `config`). The flag is used by `own()` so that an auto-owned
   * scope is not stamped into a child task's long-lived `runConfig` — that
   * stamp would survive past the parent run's `finally`-block disposal and
   * leave the child holding a reference to a disposed scope.
   */
  protected ownsResourceScope = false;

  /**
   * Input streams for pass-through streaming tasks.
   * Set by the graph runner before executing a streaming task that has
   * upstream streaming edges. Keyed by input port name.
   */
  public inputStreams?: Map<string, ReadableStream<StreamEvent>>;

  /**
   * Stable identifier for the current graph run. Set from IRunConfig.runId by
   * handleStart; threaded into IExecuteContext so tasks can correlate their
   * work to the enclosing run.
   */
  protected runId?: string;

  /**
   * Tracks task types that have already received the "private policy without
   * runId" downgrade warning, so the warning fires only once per task type
   * across the process lifetime.
   *
   * Process-global and never reset: in long-lived processes that dynamically
   * generate task-type names this set can grow unbounded. It is also
   * test-order-dependent — a prior test that triggers the warning suppresses a
   * later test's expected warning. Tests that assert on this warning should
   * clear it (or use a unique task type) in setup. Bounding/eviction is left as
   * a future improvement; the per-type cardinality is small in practice.
   */
  private static __privateWithoutRunIdWarned = new Set<string>();

  constructor(task: ITask<Input, Output, Config>) {
    this.task = task;
    this.own = this.own.bind(this);
    this.disown = this.disown.bind(this);
    this.handleProgress = this.handleProgress.bind(this);
    this.cacheCoordinator = new CacheCoordinator(task);
    this.streamProcessor = new StreamProcessor(task);
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  async run(overrides: Partial<Input> = {}, config: IRunConfig = {}): Promise<Output> {
    // Reject concurrent run() on the same TaskRunner. Mirrors
    // TaskGraphRunner.handleStart's "Graph is already running" check.
    // Raised before any `this.*` mutation so the in-flight run is undisturbed.
    if (this.task.status === TaskStatus.PROCESSING) {
      throw new TaskConfigurationError(
        `Task "${this.task.type}" is already running. Concurrent run() calls on the same TaskRunner are not supported.`
      );
    }

    const ownsScope = config.resourceScope === undefined;
    const effectiveConfig: IRunConfig = ownsScope
      ? { ...config, resourceScope: new ResourceScope({ strategy: config.disposeStrategy }) }
      : config;
    this.ownsResourceScope = ownsScope;

    // ctx is threaded through locals from here; nothing inside run() re-reads
    // this.currentCtx (which can be nulled by handleAbort firing on the abort
    // listener during an interleaved abort). Declared outside the try so the
    // finally block can run scope cleanup even if handleStart itself throws.
    let ctx: TaskRunContext | undefined;
    try {
      ctx = await this.handleStart(effectiveConfig);

      const proto = Object.getPrototypeOf(this.task);
      if (
        proto.execute === Task.prototype.execute &&
        typeof proto.executeStream !== "function" &&
        proto.executePreview !== Task.prototype.executePreview
      ) {
        throw new TaskConfigurationError(
          `Task "${this.task.type}" implements only executePreview() and cannot be run via run(). ` +
            `After the run/runPreview split, run() requires execute() (or executeStream()). ` +
            `See docs/technical/02-dual-mode-execution.md.`
        );
      }

      try {
        this.task.setInput(overrides);

        await this.resolveSchemas();

        const inputs: Input = await this.hydrateInputRefs(this.task.runInputData as Input);
        this.task.runInputData = inputs;
        const streamWiredSkips = this.streamWiredValidationSkips(inputs);
        const isValid = await this.task.validateInput(inputs, streamWiredSkips);
        if (!isValid) {
          throw new TaskInvalidInputError("Invalid input data");
        }

        if (ctx.abortController.signal.aborted) {
          await this.handleAbort(ctx);
          throw new TaskAbortedError("Promise for task created and aborted before run");
        }

        const isStreamable = isTaskStreamable(this.task);

        // Warn if schema declares streaming but executeStream is not implemented
        if (!isStreamable && typeof this.task.executeStream !== "function") {
          const streamMode = getOutputStreamMode(this.task.outputSchema());
          if (streamMode !== "none") {
            getLogger().warn(
              `Task "${this.task.type}" declares streaming output (x-stream: "${streamMode}") ` +
                `but does not implement executeStream(). Falling back to non-streaming execute().`
            );
          }
        }

        let policy = this.task.getCachePolicy(inputs);

        // A port fed by a live event stream has no settled value when the
        // cache key is computed — the streamed content cannot contribute to
        // the key, so two runs differing only in stream payload would collide
        // on one entry (stale hits, poisoned rows). Disable caching for any
        // run consuming a live stream at an unsettled port; a drained edge
        // settles the value before this point and keeps caching as usual.
        if (streamWiredSkips !== undefined && streamWiredSkips.size > 0) {
          policy = { kind: "none" };
        }

        // Standalone TaskRunner cannot namespace private cache writes without a
        // runId — TaskGraphRunner owns the wrap. If a standalone caller routes
        // to the private slot with no runId, downgrade to `kind: "none"` so the
        // task does not write directly into the shared private repo (which
        // would collide across callers). Warn once per task type so the
        // configuration mistake surfaces without flooding the log.
        if (
          policy.kind === "private" &&
          !this.runId &&
          this.cacheRegistry?.private !== undefined &&
          !(this.cacheRegistry.private instanceof RunPrivateCacheRepo)
        ) {
          const taskType = this.task.type;
          if (!TaskRunner.__privateWithoutRunIdWarned.has(taskType)) {
            TaskRunner.__privateWithoutRunIdWarned.add(taskType);
            getLogger().warn(
              `TaskRunner: task "${taskType}" has a private cache policy but no runId was ` +
                `provided. Private cache writes are skipped for this run — use TaskGraphRunner ` +
                `with runId for run-namespaced private caching, or provide an already namespaced ` +
                `private cache repo in CACHE_REGISTRY.`
            );
          }
          policy = { kind: "none" };
        }

        ctx.telemetrySpan?.setAttributes({
          "workglow.task.cache_policy": policy.kind,
        });

        const keyInputs = await this.cacheCoordinator.buildKeyForPolicy(
          inputs,
          this.cacheRegistry,
          policy
        );
        const referenceThresholdBytes = resolveReferenceThreshold(
          config.referenceThresholdBytes ?? this.task.runConfig.referenceThresholdBytes
        );
        let outputs = await this.cacheCoordinator.lookupByPolicy(
          keyInputs,
          this.cacheRegistry,
          policy,
          isStreamable,
          ctx,
          {
            hasMaterializingConsumers: config.hasMaterializingConsumers === true,
            hasStreamingConsumers: config.hasStreamingConsumers === true,
            edgeBackpressure: config.edgeBackpressure,
          }
        );

        if (outputs === undefined) {
          // Under the no-accumulation opt-in, build per-port sinks for EVERY
          // streamable mode (append/object/binary) via the port-aware backing;
          // otherwise fall back to the legacy single-binary-port sink (adapted
          // to the same StreamSink shape). Both run memory-bounded; the runtime
          // threshold controls whether the resulting CacheRef survives in
          // Output or is rehydrated inline below.
          const portSinks =
            isStreamable && this.noAccumulation === true
              ? this.cacheCoordinator.getRefSinksByPolicy(
                  keyInputs,
                  this.cacheRegistry,
                  policy,
                  this.task.outputSchema()
                )
              : undefined;
          const refSinks =
            portSinks ??
            (isStreamable
              ? wrapBinarySinks(
                  this.cacheCoordinator.getBinaryRefSinksByPolicy(
                    keyInputs,
                    this.cacheRegistry,
                    policy,
                    this.task.outputSchema()
                  )
                )
              : undefined);

          // A streamable task with delta-mode output ports, a cache in play,
          // and no sink resolved has nowhere to route those deltas. If
          // accumulation is also off — the graph opted the task out expecting
          // a sink, but the policy resolved to none here (a private policy
          // without a usable slot, or a stream-wired run downgraded above) —
          // the deltas would be silently discarded and the task would return
          // (and cache!) an empty output. Force accumulation so the task
          // still materializes its own output. Cache-off runs keep the
          // documented raw-finish contract: with no cache configured,
          // shouldAccumulate=false means every consumer takes the live stream
          // and the raw `{}` finish is intentional.
          if (
            isStreamable &&
            refSinks === undefined &&
            this.cacheRegistry !== undefined &&
            !ctx.shouldAccumulate &&
            getStreamingPorts(this.task.outputSchema()).some((p) => isDeltaStreamMode(p.mode))
          ) {
            ctx.shouldAccumulate = true;
          }

          outputs = isStreamable
            ? await this.streamProcessor.run(inputs, ctx, {
                registry: this.registry,
                resourceScope: this.resourceScope,
                inputStreams: this.inputStreams,
                onProgress: this.handleProgress.bind(this),
                own: this.own,
                disown: this.disown,
                refSinks,
                streamHighWaterBytes: this.streamHighWaterBytes,
                edgeBackpressure: config.edgeBackpressure,
              })
            : await this.executeTask(inputs, ctx);

          // Save the wire form FIRST: a CacheRef at a binary port is a small
          // JSON-safe envelope, while an inline Blob/ArrayBuffer would be
          // destroyed by JSON-row backings (JSON.stringify(Blob) === "{}").
          // The row therefore always carries the ref; hydration below applies
          // only to the value returned to the caller.
          try {
            await this.cacheCoordinator.saveByPolicy(
              keyInputs,
              outputs as Output,
              this.cacheRegistry,
              policy
            );
          } catch (saveErr) {
            // The stream sink already wrote the blob and minted a CacheRef
            // before we got here; the row write failure leaves that blob
            // unreferenced. Best-effort delete it so the cache directory
            // does not accumulate orphans on every save failure.
            if (refSinks !== undefined && outputs !== undefined) {
              await this.cacheCoordinator.cleanupOrphanBlobsForStreamPorts(
                outputs as Output,
                this.cacheRegistry,
                policy,
                this.task.outputSchema()
              );
            }
            throw saveErr;
          }

          // Rehydrate refs whose committed size is below the configured
          // threshold so callers see inline values for small outputs (threshold
          // default = 64 KiB). Refs at/above threshold survive. threshold = 0
          // forces every ref to survive regardless of size.
          if (outputs !== undefined && refSinks !== undefined) {
            outputs = await this.cacheCoordinator.hydrateRefsBelowThreshold(
              outputs as Output,
              this.cacheRegistry,
              policy,
              this.task.outputSchema(),
              referenceThresholdBytes
            );
          }
        } else {
          // Cache hit: rows store refs (wire form), so apply the same
          // below-threshold hydration a fresh run applies before returning —
          // small outputs come back as inline Blob/ArrayBuffer either way.
          outputs = await this.cacheCoordinator.hydrateRefsBelowThreshold(
            outputs as Output,
            this.cacheRegistry,
            policy,
            this.task.outputSchema(),
            referenceThresholdBytes
          );
        }
        this.task.runOutputData = outputs ?? ({} as Output);

        await this.handleComplete(ctx);

        return this.task.runOutputData as Output;
      } catch (err: any) {
        await this.handleError(err, ctx);
        // If a timeout triggered the abort, throw the TaskTimeoutError instead
        // of the generic TaskAbortedError that the task's execute() may have thrown.
        throw this.task.error instanceof TaskTimeoutError ? this.task.error : err;
      }
    } catch (err: any) {
      // Reachable when handleStart() throws before assigning `ctx` (e.g.,
      // resourceScope.runStart or telemetry init blows up). Without this,
      // task.status would be stuck at PROCESSING with currentCtx still set
      // and no error/event ever emitted.
      if (ctx === undefined) {
        const partial = this.currentCtx;
        if (partial) {
          await this.handleError(err, partial);
        } else {
          this.task.status = TaskStatus.FAILED;
          this.task.error =
            err instanceof TaskError
              ? err
              : new TaskFailedError(
                  `Task "${this.task.type}" (${this.task.id}): ${err?.message || "Task failed"}`
                );
          if (this.task.error instanceof TaskError) {
            this.task.error.taskType ??= this.task.type;
            this.task.error.taskId ??= this.task.id;
          }
          this.task.emit("error", this.task.error);
          this.task.emit("status", this.task.status);
        }
        this.running = false;
      }
      throw err;
    } finally {
      if (ownsScope) {
        await effectiveConfig.resourceScope!.runComplete();
        this.resourceScope = undefined;
      }
      this.ownsResourceScope = false;
    }
  }

  /**
   * Ports to exempt from whole-value input validation this run: an input port
   * fed by a live event stream has no settled value to validate (its slot holds
   * only a {@link CacheRef} pointer, or nothing, until the stream finishes).
   * A port that already carries a settled value is still validated — only a
   * ref/undefined slot is skipped — so off the no-accumulation path (where the
   * drain materializes the value) behavior is unchanged. A port that declares
   * `x-validate-stream: true` opts back in (it wants its stream materialized and
   * validated, forcing the accumulation fallback for that edge).
   */
  private streamWiredValidationSkips(inputs: Input): ReadonlySet<string> | undefined {
    if (!this.inputStreams || this.inputStreams.size === 0) return undefined;
    if (inputs === null || typeof inputs !== "object") return undefined;
    const schema = this.task.inputSchema();
    const source = inputs as Record<string, unknown>;
    let skip: Set<string> | undefined;
    for (const port of this.inputStreams.keys()) {
      if (getPortStreamMode(schema, port) === "none") continue;
      if (portForcesStreamValidation(schema, port)) continue;
      const value = source[port];
      if (value !== undefined && !isCacheRef(value)) continue;
      (skip ??= new Set()).add(port);
    }
    return skip;
  }

  /**
   * Hydrate branded {@link CacheRef} values in resolved inputs to inline
   * values before `execute()` runs, resolving against the run's cache registry
   * (private repo first, then deterministic). Materialization is mode-aware:
   * an `append` / `object` ref decodes through its stream codec back to the
   * string / folded object the port expects; anything else follows the input
   * port's `format` annotation (`"binary"` → `ArrayBuffer`, else → `Blob`).
   *
   * Stream-wired input ports with a live input stream are skipped: those
   * consumers take their data from the stream and the ref at the port remains
   * the durable pointer — hydrating it would re-materialize what the stream
   * already delivers.
   *
   * Hydration runs before cache-key computation so a ref-bearing input
   * fingerprints identically to the materialized input a fresh upstream run
   * would have produced.
   *
   * A ref that no longer resolves throws: by this point the bytes were
   * expected to exist, and letting `undefined` flow into `execute()` produces
   * far less debuggable failures than a named-port error.
   */
  private async hydrateInputRefs(inputs: Input): Promise<Input> {
    if (inputs === null || typeof inputs !== "object") return inputs;
    const repos = [this.cacheRegistry?.private, this.cacheRegistry?.deterministic].filter(
      (r): r is TaskOutputRepository => r !== undefined && typeof r.getOutputByRef === "function"
    );
    if (repos.length === 0) return inputs;

    const schema = this.task.inputSchema();
    const source = inputs as Record<string, unknown>;
    const hydrations = await Promise.all(
      Object.entries(source).map(async ([port, value]) => {
        if (!isCacheRef(value)) return undefined;
        // Only resolve a ref at a port whose schema admits one — a
        // delta-stream port (`append` / `object` / `binary`) or a
        // blob/binary-format port, mirroring the output-side gating in
        // hydrateRefsBelowThreshold. A ref-shaped value at any other port is
        // not this runner's to interpret: resolving it would let arbitrary
        // input JSON read cache entries into ports that never carry refs.
        // Leave it untouched for normal input validation to reject.
        const portMode = getPortStreamMode(schema, port);
        const portFormat = getBinaryPortFormat(schema, port);
        if (!isDeltaStreamMode(portMode) && portFormat !== "blob" && portFormat !== "binary") {
          return undefined;
        }
        // A stream-wired input port (any mode) with a live input stream keeps
        // its ref as the durable pointer — the consumer takes its data from
        // the stream, so hydrating the ref would re-materialize what the
        // stream already delivers.
        if (portMode !== "none" && this.inputStreams?.has(port)) {
          return undefined;
        }
        // append / object refs persist codec-encoded delta bytes; decode them
        // back to the settled value instead of handing a byte Blob to a
        // string/object port.
        if (value.mode !== undefined && value.mode !== "binary" && isDeltaStreamMode(value.mode)) {
          for (const repo of repos) {
            const stream = await streamRefViaBacking(value, repo);
            if (stream === undefined) continue;
            const inlined = await getStreamPortCodec(value.mode).materialize(stream, port);
            return { port, inlined };
          }
          throw this.unresolvableInputRefError(port);
        }
        let blob: Blob | undefined;
        for (const repo of repos) {
          blob = await repo.getOutputByRef!(value);
          if (blob !== undefined) break;
        }
        if (blob === undefined) throw this.unresolvableInputRefError(port);
        const inlined =
          getBinaryPortFormat(schema, port) === "binary" ? await blob.arrayBuffer() : blob;
        return { port, inlined };
      })
    );
    let out: Record<string, unknown> | undefined;
    for (const h of hydrations) {
      if (!h) continue;
      out ??= { ...source };
      out[h.port] = h.inlined;
    }
    return (out ?? source) as Input;
  }

  private unresolvableInputRefError(port: string): TaskFailedError {
    return new TaskFailedError(
      `Task "${this.task.type}" input port "${port}" holds a cache ref that no configured ` +
        `cache backing can resolve (entry evicted?).`
    );
  }

  public async runPreview(overrides: Partial<Input> = {}): Promise<Output> {
    if (this.task.status === TaskStatus.PROCESSING) {
      return this.task.runOutputData as Output;
    }

    this.task.setInput(overrides);

    await this.resolveSchemas();

    await this.handleStartPreview();

    // Build a transient context for preview overrides — preview doesn't share the
    // full lifecycle but executeTaskPreview's signature requires a ctx.
    const ctx = new TaskRunContext();

    try {
      const inputs: Input = this.task.runInputData as Input;
      const isValid = await this.task.validateInput(inputs);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      const resultPreview = await this.executeTaskPreview(inputs, ctx);
      if (resultPreview !== undefined) {
        this.task.runOutputData = resultPreview;
      }

      await this.handleCompletePreview();
    } catch (err: any) {
      getLogger().debug("runPreview failed", { taskId: this.task.config?.id, error: err });
      await this.handleErrorPreview();
    } finally {
      ctx.dispose();
      return this.task.runOutputData as Output;
    }
  }

  /**
   * Async iterator producing preview outputs as upstream tasks stream
   * snapshots. Yields once immediately with the current preview state, then
   * yields again whenever upstream snapshots have arrived since the last
   * yield, until all relevant upstream streams complete (or the consumer
   * breaks out of the loop).
   *
   * Backpressure is single-buffered and last-write-wins: snapshots arriving
   * while a runPreview() iteration is in flight all overwrite runInputData,
   * and the next iteration sees only the latest value. Consumers that need
   * to observe every intermediate snapshot must pace the producer (e.g.,
   * wait for each yield to be processed before emitting the next). This
   * matches live-preview UI semantics — show the latest, drop stale frames.
   *
   * Reuses runPreview() under the hood. Errors during a single iteration
   * are caught and skipped — the iterator never throws to the consumer
   * mid-loop.
   *
   * Watches direct upstream tasks only. Indirect (grandparent) snapshots
   * propagate through chained preview re-runs as upstream parents' values
   * update.
   */
  public async *runPreviewStream(overrides: Partial<Input> = {}): AsyncIterable<Output> {
    // 1. Identify direct upstream tasks and their connecting dataflows.
    //    runPreviewStream calls task.runPreview() directly (not the graph
    //    runner's runPreview), so it does not benefit from the graph-runner's
    //    copyInputFromEdgesToNode pull. We propagate snapshot values into the
    //    target task's runInputData ourselves, mirroring that pull but driven
    //    by upstream stream events.
    const graph = this.task.parentGraph;
    type DataflowInfo = { upstream: ITask; sourcePort: string; targetPort: string };
    const dataflowInfos: DataflowInfo[] = [];
    if (graph) {
      for (const df of graph.getSourceDataflows(this.task.id)) {
        const upstream = graph.getTask(df.sourceTaskId);
        if (upstream) {
          dataflowInfos.push({
            upstream,
            sourcePort: df.sourceTaskPortId,
            targetPort: df.targetTaskPortId,
          });
        }
      }
    }

    // 2. Track upstreams that may still emit snapshots (pending, processing, or streaming).
    //    An upstream is "done" once its stream ends or it reaches a terminal state.
    const upstreamTasks = new Set(dataflowInfos.map((d) => d.upstream));
    const pendingUpstreams = new Set<ITask>(
      [...upstreamTasks].filter(
        (u) =>
          u.status === TaskStatus.STREAMING ||
          u.status === TaskStatus.PENDING ||
          u.status === TaskStatus.PROCESSING
      )
    );

    // 3. Set up dirty/wake machinery.
    let dirty = true;
    let wakeResolve: (() => void) | undefined;
    const wakeNext = (): Promise<void> =>
      new Promise<void>((resolve) => {
        wakeResolve = resolve;
      });
    const wake = () => {
      const r = wakeResolve;
      wakeResolve = undefined;
      if (r) r();
    };

    // 4. Subscribe to all upstream tasks that could stream.
    const cleanupFns: Array<() => void> = [];
    for (const upstream of pendingUpstreams) {
      const myDataflows = dataflowInfos.filter((d) => d.upstream === upstream);

      const onChunk = (event: StreamEvent) => {
        if (event.type !== "snapshot") return;
        const snapshotData = (event as { data?: Record<string, unknown> }).data;
        if (snapshotData) {
          for (const { sourcePort, targetPort } of myDataflows) {
            const value = sourcePort === "*" ? snapshotData : snapshotData[sourcePort];
            if (value !== undefined) {
              (this.task.runInputData as Record<string, unknown>)[targetPort] = value;
            }
          }
        }
        dirty = true;
        wake();
      };
      const onEnd = () => {
        pendingUpstreams.delete(upstream);
        wake();
      };
      const onStatus = (status: TaskStatus) => {
        // If upstream completes without streaming, remove it from pending.
        if (
          status === TaskStatus.COMPLETED ||
          status === TaskStatus.FAILED ||
          status === TaskStatus.DISABLED
        ) {
          pendingUpstreams.delete(upstream);
          wake();
        }
      };
      upstream.on("stream_chunk", onChunk);
      upstream.on("stream_end", onEnd);
      upstream.on("status", onStatus);
      cleanupFns.push(() => {
        upstream.off("stream_chunk", onChunk);
        upstream.off("stream_end", onEnd);
        upstream.off("status", onStatus);
      });
    }

    // 4b. Re-check upstream status after subscribing. If any reached a terminal
    //     state in the gap between step 2 (status read) and step 4 (listener
    //     attach), prune them now — listeners attached in step 4 won't fire
    //     retroactively for events that already happened. The first iteration
    //     of the loop still yields a preview from whatever runInputData
    //     currently holds.
    for (const upstream of [...pendingUpstreams]) {
      if (
        upstream.status === TaskStatus.COMPLETED ||
        upstream.status === TaskStatus.FAILED ||
        upstream.status === TaskStatus.DISABLED
      ) {
        pendingUpstreams.delete(upstream);
      }
    }

    // 5. Iterator loop.
    try {
      while (true) {
        if (dirty) {
          dirty = false;
          try {
            const out = await this.runPreview(overrides);
            yield out;
          } catch (err) {
            getLogger().debug("runPreviewStream iteration failed", {
              taskId: this.task.config?.id,
              error: err,
            });
          }
          continue;
        }
        if (pendingUpstreams.size === 0) return;
        await wakeNext();
      }
    } finally {
      for (const off of cleanupFns) off();
    }
  }

  public abort(): void {
    this.currentCtx?.abortController.abort();
  }

  /**
   * Stream-pacing options retained from the current run's config (resolved in
   * handleStart), in the shape both `TaskGraphRunConfig` and {@link IRunConfig}
   * accept. Compound tasks spread this into their subgraph runs so nested
   * graphs inherit the caller's passthrough opt-in, high-water mark, and
   * watchdog.
   */
  public get streamRunOptions(): Pick<
    IRunConfig,
    "noAccumulation" | "streamHighWaterBytes" | "streamGateWatchdogMs"
  > {
    return {
      noAccumulation: this.noAccumulation,
      streamHighWaterBytes: this.streamHighWaterBytes,
      streamGateWatchdogMs: this.streamGateWatchdogMs,
    };
  }

  // ========================================================================
  // Protected methods
  // ========================================================================

  /**
   * What {@link own} actually added to the subgraph, keyed by the value the
   * caller handed in. A graph or workflow is adapted into a wrapper task and
   * `own` hands the caller back their original, so the wrapper's id — the only
   * thing {@link disown} can remove — is otherwise unrecoverable. Weak so an
   * owned task that is never disowned still dies with the subgraph.
   */
  private readonly ownedWrappers = new WeakMap<object, ITask>();

  /**
   * Whether the wrapper {@link own} recorded for a value is still in the
   * subgraph. Clearing the subgraph — a graph run's `resetGraph`, or an explicit
   * `regenerateGraph()` — does not touch {@link ownedWrappers}, so a recorded
   * wrapper is not proof of current ownership, and only one still present is a
   * genuine double-`own`.
   *
   * Note this makes a *reset* the thing that licenses re-owning, not a re-run:
   * a bare second `task.run()` leaves the subgraph populated, so re-owning the
   * same value there is rejected — exactly as owning a plain `ITask` twice
   * already was, by the duplicate subgraph id.
   */
  private isStillOwned(wrapper: ITask): boolean {
    // A map lookup, where `hasChildren()` would materialize the whole child
    // array on every own/disown. Reading the subgraph cannot create a stray one
    // here: a recorded wrapper means `own` already built it.
    return this.task.subGraph.getTask(wrapper.id) !== undefined;
  }

  protected own<T extends Taskish<any, any>>(i: T, config: TaskConfig = {}): T {
    const trackable = isOwnTrackable(i);
    if (trackable) {
      // `ensureTask` returns a plain ITask as-is, so owning one twice throws on
      // the duplicate subgraph id. A graph or workflow is adapted into a *fresh*
      // wrapper each call, so the second `own` would silently succeed and
      // overwrite the recorded wrapper — stranding the first in the subgraph
      // with nothing left that can name it for `disown`. Fail the same way.
      const previous = this.ownedWrappers.get(i);
      if (previous !== undefined) {
        if (this.isStillOwned(previous)) {
          throw new TaskConfigurationError(
            `own(): value is already owned by task ${String(this.task.config?.id)} as subgraph task ${String(previous.id)}. Call disown() before owning it again.`
          );
        }
        this.ownedWrappers.delete(i);
      }
    }
    const task = ensureTask(i, { ...config, isOwned: true });
    this.task.subGraph.addTask(task);
    if (trackable) {
      this.ownedWrappers.set(i, task);
    }
    // Propagate parent registry and abort signal to owned ITask instances so
    // that calling task.run() on the returned value inherits this execution context.
    if (hasRunConfig(i)) {
      // Only propagate `resourceScope` if the caller owns its lifecycle. Stamping
      // an auto-created scope into a long-lived `runConfig` leaks a reference
      // past the parent run's `finally`-block disposal — the next `task.run()`
      // on the owned instance would then see a disposed scope, skip auto-create,
      // and silently drop disposers on its cleared Map. With caller-passed
      // scopes the caller controls disposal, so the propagation is safe and
      // preserves resource-sharing across owned-task runs.
      const stamp: Partial<IRunConfig> = {
        registry: this.registry,
        signal: this.currentCtx?.abortController.signal,
      };
      if (!this.ownsResourceScope) {
        stamp.resourceScope = this.resourceScope;
      }
      Object.assign(i.runConfig, stamp);
    }
    // Notify listeners that the entitlement landscape may have changed.
    // For GraphAsTask this is also handled by the subGraph subscription, but
    // non-GraphAsTask tasks with dynamic entitlements (e.g. AiTask) need it too.
    if ((this.task.constructor as typeof Task).hasDynamicEntitlements) {
      this.task.emit("entitlementChange", this.task.entitlements());
    }
    return i;
  }

  /**
   * Releases a value previously registered by {@link own}. `own` is add-only and
   * the subgraph is cleared only between graph runs, so a task owning one child
   * per loop iteration retains them all — with whatever each child's own
   * subgraph accumulated — until its `execute()` returns.
   *
   * Takes the value `own` returned (for a graph or workflow that is the original,
   * not the wrapper task actually in the subgraph) and resolves it through
   * {@link ownedWrappers}. A value this runner never owned is a no-op, so
   * disowning after an `own` that was an identity no-op against a stub context
   * is harmless.
   */
  protected disown<T extends Taskish<any, any>>(i: T): void {
    if (!isOwnTrackable(i)) return;
    const wrapper = this.ownedWrappers.get(i);
    if (wrapper === undefined) return;
    // Drop the record even when the wrapper is already gone (a subgraph reset
    // between runs), so the value can be owned again.
    this.ownedWrappers.delete(i);
    if (!this.isStillOwned(wrapper)) return;
    this.task.subGraph.removeTask(wrapper.id);
    if ((this.task.constructor as typeof Task).hasDynamicEntitlements) {
      this.task.emit("entitlementChange", this.task.entitlements());
    }
  }

  protected async executeTask(input: Input, ctx: TaskRunContext): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: ctx.abortController.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      disown: this.disown,
      registry: this.registry,
      resourceScope: this.resourceScope,
      runId: this.runId,
    });
    return result;
  }

  protected async executeTaskPreview(
    input: Input,
    _ctx: TaskRunContext
  ): Promise<Output | undefined> {
    return this.task.executePreview?.(input, { own: this.own });
  }

  // ========================================================================
  // Protected Handlers
  // ========================================================================

  /**
   * Resolves config and input schema annotations (e.g. mcp-server references)
   * by mutating task.config and task.runInputData. Always resolves config from
   * originalConfig so re-runs use the original string IDs, not previously resolved
   * objects. Shared between run() and runPreview() to avoid duplication.
   */
  private async resolveSchemas(): Promise<void> {
    const configSchema = (this.task.constructor as typeof Task).configSchema();
    if (schemaHasFormatAnnotations(configSchema)) {
      const source = (this.task as unknown as Task).originalConfig ?? this.task.config;
      const resolved = await resolveSchemaInputs(
        { ...source } as Record<string, unknown>,
        configSchema,
        { registry: this.registry }
      );
      Object.assign(this.task.config, resolved);
    }

    // Resolve schema-annotated inputs (models, repositories) before validation.
    // Dynamic-schema tasks (InputTask, GraphAsTask, …) store the effective schema on
    // the instance; the static schema has no format annotations and would skip hydration.
    const ctor = this.task.constructor as typeof Task;
    const schema = ctor.hasDynamicSchemas ? this.task.inputSchema() : ctor.inputSchema();
    this.task.runInputData = (await resolveSchemaInputs(
      this.task.runInputData as Record<string, unknown>,
      schema,
      { registry: this.registry }
    )) as Input;
  }

  /**
   * Handles task start. Concurrent-run rejection happens in {@link run} before
   * any state mutation; by the time `handleStart` runs, the task status is
   * guaranteed to be non-PROCESSING.
   *
   * Returns the per-run {@link TaskRunContext} so `run()` can thread it
   * through locals instead of re-reading `this.currentCtx` across awaits.
   * The instance field `this.currentCtx` is still set as the *external*
   * pointer used by no-arg public methods (`abort()`, `disable()`); internal
   * flow should use the returned ctx exclusively.
   */
  protected async handleStart(config: IRunConfig = {}): Promise<TaskRunContext> {
    this.running = true;

    this.task.startedAt = new Date();
    this.task.progress = 0;
    this.task.status = TaskStatus.PROCESSING;

    // Build per-run context (handles abortController + parentSignal wiring)
    const ctx = new TaskRunContext(config.signal);
    this.currentCtx = ctx;

    // Listener captures the local `ctx`, not `this.currentCtx`. If a later run
    // replaces the instance field before this listener fires, handleAbort still
    // operates on the ctx the listener was attached to.
    ctx.abortController.signal.addEventListener("abort", () => {
      void this.handleAbort(ctx);
    });

    // Apply registry override first so that cache resolution below uses the
    // correct per-run ServiceRegistry rather than the stale instance field.
    if (config.registry) {
      this.registry = config.registry;
    }

    // Propagate run identifier for use in IExecuteContext.
    this.runId = config.runId;

    // Retain stream-pacing options for this run (like outputCache) so compound
    // runners can forward them into subgraph runs — a nested graph must honor
    // the same passthrough opt-in, high-water mark, and watchdog the caller
    // configured.
    this.noAccumulation = config.noAccumulation ?? this.task.runConfig?.noAccumulation;
    this.streamHighWaterBytes =
      config.streamHighWaterBytes ?? this.task.runConfig?.streamHighWaterBytes;
    this.streamGateWatchdogMs =
      config.streamGateWatchdogMs ?? this.task.runConfig?.streamGateWatchdogMs;

    // Cache resolution: prefer CacheRegistry (via ServiceRegistry); honour legacy
    // config.outputCache as a back-compat shim that maps to the deterministic slot.
    const legacy = config.outputCache ?? this.task.runConfig?.outputCache;
    if (legacy === false) {
      this.cacheRegistry = undefined;
      this.outputCache = undefined;
    } else if (legacy instanceof TaskOutputRepository) {
      // Legacy repo passed directly → treat as the deterministic slot.
      this.cacheRegistry = new DefaultCacheRegistry({ deterministic: legacy });
      this.outputCache = legacy;
    } else if (legacy === true) {
      // Legacy boolean true → pull from TASK_OUTPUT_REPOSITORY in the global registry.
      const instance = globalServiceRegistry.has(TASK_OUTPUT_REPOSITORY)
        ? globalServiceRegistry.get(TASK_OUTPUT_REPOSITORY)
        : undefined;
      this.outputCache = instance;
      this.cacheRegistry = instance
        ? new DefaultCacheRegistry({ deterministic: instance })
        : undefined;
    } else {
      // No legacy override → look up CACHE_REGISTRY from the per-run ServiceRegistry.
      this.outputCache = undefined;
      this.cacheRegistry = this.registry.has(CACHE_REGISTRY)
        ? this.registry.get(CACHE_REGISTRY)
        : undefined;
    }

    // The private tier's whole job is to reject foreign-run refs. If the two
    // slots are wired to the same backing instance, the private wrapper rejects
    // the ref but hydrateInputRefs' deterministic fallback resolves it anyway
    // through the unscoped reader, reopening the same cross-run leak. Reject
    // the misconfiguration up front rather than let hydration silently bypass
    // the scope.
    if (
      this.cacheRegistry?.private instanceof RunPrivateCacheRepo &&
      this.cacheRegistry.deterministic !== undefined &&
      this.cacheRegistry.private.backing === this.cacheRegistry.deterministic
    ) {
      throw new TaskConfigurationError(
        "CacheRegistry: the `private` and `deterministic` slots resolve to the same " +
          "backing repository. Run-scoping via RunPrivateCacheRepo is bypassed when a " +
          "foreign-run ref rejected by the private wrapper still resolves through the " +
          "unscoped deterministic reader. Point the two slots at distinct backings."
      );
    }

    // shouldAccumulate defaults to true (backward-compatible for standalone runs)
    ctx.shouldAccumulate = config.shouldAccumulate !== false;

    if (config.updateProgress) {
      this.updateProgress = config.updateProgress;
    }

    if (config.resourceScope) {
      this.resourceScope = config.resourceScope;
    }

    // Notify the disposal strategy that a new run is starting. Inactivity
    // strategies use this hook to clear any pending idle timers that were
    // armed at the previous `runComplete`, closing the race window where a
    // timer could fire mid-run and dispose a resource we are about to use.
    if (this.resourceScope) {
      await this.resourceScope.runStart();
    }

    // Early-out if parent signal was already aborted (TaskRunContext constructor
    // already aborted ctx.abortController in that case)
    if (ctx.abortController.signal.aborted) return ctx;

    // Start timeout timer if configured (timeout is a design-time config property).
    // Fire on the captured ctx's controller rather than this.abort() so a timeout
    // armed for *this* run can't accidentally abort a later run if scope-teardown
    // racing leaves the timer alive past terminal-handler.
    const timeout = (this.task.config as Record<string, unknown>).timeout as number | undefined;
    if (timeout !== undefined && timeout > 0) {
      ctx.pendingTimeoutError = new TaskTimeoutError(timeout);
      ctx.timeoutTimer = setTimeout(() => {
        ctx.abortController.abort();
      }, timeout);
    }

    // Start telemetry span
    const telemetry = getTelemetryProvider();
    if (telemetry.isEnabled) {
      ctx.telemetrySpan = telemetry.startSpan("workglow.task.run", {
        attributes: {
          "workglow.task.type": this.task.type,
          "workglow.task.id": String(this.task.config.id),
          "workglow.task.title": this.task.title || undefined,
        },
      });
    }

    this.task.emit("start");
    this.task.emit("status", this.task.status);
    return ctx;
  }
  private updateProgress = async (
    _task: ITask,
    _progress: number | undefined,
    _message?: string,
    ..._args: any[]
  ) => {};

  protected async handleStartPreview(): Promise<void> {
    this.previewRunning = true;
  }

  /**
   * Clears the timeout timer on the given ctx if one is active.
   */
  protected clearTimeoutTimer(ctx: TaskRunContext): void {
    if (ctx.timeoutTimer !== undefined) {
      clearTimeout(ctx.timeoutTimer);
      ctx.timeoutTimer = undefined;
    }
  }

  /**
   * Handles task abort.
   *
   * Idempotent per-ctx via {@link TaskRunContext.terminated}: the abort
   * listener fires synchronously inside `controller.abort()` and may race
   * with the run flow's own catch-block; both paths can land here. The
   * `terminated` flag (set before any await) lets the second arrival fall
   * through, while `task.status` is too brittle to gate on because adjacent
   * runs on the same task can mutate it.
   */
  protected async handleAbort(ctx: TaskRunContext): Promise<void> {
    if (ctx.terminated) return;
    ctx.terminated = true;
    this.clearTimeoutTimer(ctx);
    this.task.status = TaskStatus.ABORTING;
    await this.handleProgress(100);
    // Use the pending timeout error if the abort was triggered by a timeout
    this.task.error = ctx.pendingTimeoutError ?? new TaskAbortedError();

    if (ctx.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.ERROR, "aborted");
      ctx.telemetrySpan.addEvent("workglow.task.aborted", {
        "workglow.task.error": this.task.error.message,
      });
      ctx.telemetrySpan.end();
    }

    // Call optional cleanup method for resource release
    if (typeof this.task.cleanup === "function") {
      try {
        await this.task.cleanup();
      } catch {
        // Cleanup errors are swallowed — abort must not throw from cleanup
      }
    }

    ctx.dispose();
    // CAS-style clear: only release the instance pointer if it still points at
    // *this* ctx. Prevents a stale terminal handler from clobbering a newer
    // run's currentCtx.
    if (this.currentCtx === ctx) this.currentCtx = undefined;

    this.task.emit("abort", this.task.error);
    this.task.emit("status", this.task.status);
  }

  protected async handleAbortPreview(): Promise<void> {
    this.previewRunning = false;
  }

  /**
   * Handles task completion.
   *
   * Idempotent per-ctx — see {@link handleAbort} for the rationale on using
   * `ctx.terminated` instead of `task.status` as the guard.
   */
  protected async handleComplete(ctx: TaskRunContext): Promise<void> {
    if (ctx.terminated) return;
    ctx.terminated = true;
    this.clearTimeoutTimer(ctx);

    this.task.completedAt = new Date();
    this.task.status = TaskStatus.COMPLETED;
    await this.handleProgress(100);

    if (ctx.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.OK);
      ctx.telemetrySpan.end();
    }

    ctx.dispose();
    if (this.currentCtx === ctx) this.currentCtx = undefined;

    this.task.emit("complete");
    this.task.emit("status", this.task.status);
  }

  protected async handleCompletePreview(): Promise<void> {
    this.previewRunning = false;
  }

  protected async handleDisable(ctx: TaskRunContext | undefined): Promise<void> {
    // Idempotent per-ctx where one exists; falls back to status-based guard
    // for the no-active-run case (public disable() called with no current ctx).
    if (ctx?.terminated || this.task.status === TaskStatus.DISABLED) return;
    if (ctx) ctx.terminated = true;
    this.task.status = TaskStatus.DISABLED;
    await this.handleProgress(100);
    this.task.completedAt = new Date();
    ctx?.dispose();
    // Don't clobber a newer run's ctx if disable() was queued from a stale state.
    if (this.currentCtx === ctx) this.currentCtx = undefined;
    this.task.emit("disabled");
    this.task.emit("status", this.task.status);
  }

  public async disable(): Promise<void> {
    await this.handleDisable(this.currentCtx);
  }

  /**
   * Handles task error.
   *
   * If the underlying error is an abort, delegate to {@link handleAbort} —
   * which is idempotent per-ctx, so a parallel abort-listener path is safe.
   */
  protected async handleError(err: Error, ctx: TaskRunContext): Promise<void> {
    if (err instanceof TaskAbortedError) return this.handleAbort(ctx);
    if (ctx.terminated) return;
    ctx.terminated = true;
    this.clearTimeoutTimer(ctx);
    if (this.task.hasChildren()) {
      this.task.subGraph!.abort();
    }

    this.task.completedAt = new Date();
    if (err instanceof TaskError) {
      this.task.error = err;
    } else {
      this.task.error = new TaskFailedError(
        `Task "${this.task.type}" (${this.task.id}): ${err?.message || "Task failed"}`
      );
    }
    // Attach task context to all TaskError instances for programmatic access
    if (this.task.error instanceof TaskError) {
      this.task.error.taskType ??= this.task.type;
      this.task.error.taskId ??= this.task.id;
    }
    this.task.status = TaskStatus.FAILED;
    await this.handleProgress(100);

    if (ctx.telemetrySpan) {
      ctx.telemetrySpan.setStatus(SpanStatusCode.ERROR, this.task.error.message);
      ctx.telemetrySpan.setAttributes({ "workglow.task.error": this.task.error.message });
      ctx.telemetrySpan.end();
    }

    ctx.dispose();
    if (this.currentCtx === ctx) this.currentCtx = undefined;

    this.task.emit("error", this.task.error);
    this.task.emit("status", this.task.status);
  }

  protected async handleErrorPreview(): Promise<void> {
    this.previewRunning = false;
  }

  protected async handleProgress(
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ): Promise<void> {
    this.task.progress = progress;
    // Emit before graph-level work (e.g. pushOutputFromNodeToEdges) so listeners are not stalled.
    this.task.emit("progress", progress, message, ...args);
    await this.updateProgress(this.task, progress, message, ...args);
  }
}
