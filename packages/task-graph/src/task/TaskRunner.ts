/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISpan } from "@workglow/util";
import {
  getLogger,
  getTelemetryProvider,
  globalServiceRegistry,
  ResourceScope,
  ServiceRegistry,
  SpanStatusCode,
} from "@workglow/util";
import { TASK_OUTPUT_REPOSITORY, TaskOutputRepository } from "../storage/TaskOutputRepository";
import { getPortCodec } from "@workglow/util";
import type { Taskish } from "../task-graph/Conversions";
import { ensureTask } from "../task-graph/Conversions";
import { resolveSchemaInputs, schemaHasFormatAnnotations } from "./InputResolver";
import type { IRunConfig, ITask } from "./ITask";
import { ITaskRunner } from "./ITaskRunner";
import type { StreamEvent, StreamMode } from "./StreamTypes";
import { getOutputStreamMode, getStreamingPorts, isTaskStreamable } from "./StreamTypes";
import { Task } from "./Task";
import {
  TaskAbortedError,
  TaskConfigurationError,
  TaskError,
  TaskFailedError,
  TaskInvalidInputError,
  TaskTimeoutError,
} from "./TaskError";
import { TaskConfig, TaskInput, TaskOutput, TaskStatus } from "./TaskTypes";

interface SchemaProperties {
  properties?: Record<string, { format?: string }>;
}

async function serializeOutputPorts(
  output: Record<string, unknown>,
  schema: SchemaProperties,
): Promise<Record<string, unknown>> {
  if (!schema?.properties) return output;
  const out: Record<string, unknown> = { ...output };
  for (const [key, prop] of Object.entries(schema.properties)) {
    const codec = prop.format ? getPortCodec(prop.format) : undefined;
    if (codec && out[key] !== undefined) {
      out[key] = await codec.serialize(out[key]);
    }
  }
  return out;
}

async function deserializeOutputPorts(
  output: Record<string, unknown>,
  schema: SchemaProperties,
): Promise<Record<string, unknown>> {
  if (!schema?.properties) return output;
  const out: Record<string, unknown> = { ...output };
  for (const [key, prop] of Object.entries(schema.properties)) {
    const codec = prop.format ? getPortCodec(prop.format) : undefined;
    if (codec && out[key] !== undefined) {
      out[key] = await codec.deserialize(out[key]);
    }
  }
  return out;
}

async function normalizeInputsForCacheKey(
  inputs: Record<string, unknown>,
  schema: SchemaProperties,
): Promise<Record<string, unknown>> {
  if (!schema?.properties) return inputs;
  const out: Record<string, unknown> = { ...inputs };
  for (const [key, prop] of Object.entries(schema.properties)) {
    const codec = prop.format ? getPortCodec(prop.format) : undefined;
    if (codec && out[key] !== undefined) {
      out[key] = await codec.serialize(out[key]);
    }
  }
  return out;
}

/**
 * Type guard that checks whether a value is an ITask-like object with a mutable `runConfig`.
 */
function hasRunConfig(i: unknown): i is { runConfig: Partial<IRunConfig> } {
  return i !== null && typeof i === "object" && "runConfig" in (i as object);
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
  /**
   * Whether the task is currently running
   */
  protected running = false;
  protected previewRunning = false;

  /**
   * The task to run
   */
  public readonly task: ITask<Input, Output, Config>;

  /**
   * AbortController for cancelling task execution
   */
  protected abortController?: AbortController;

  /**
   * The output cache for the task
   */
  protected outputCache?: TaskOutputRepository;

  /**
   * The service registry for the task
   */
  protected registry: ServiceRegistry = globalServiceRegistry;

  /**
   * Resource scope for this task run
   */
  protected resourceScope?: ResourceScope;

  /**
   * Input streams for pass-through streaming tasks.
   * Set by the graph runner before executing a streaming task that has
   * upstream streaming edges. Keyed by input port name.
   */
  public inputStreams?: Map<string, ReadableStream<StreamEvent>>;

  /**
   * Timer handle for task-level timeout. Set when `IRunConfig.timeout` is
   * provided and cleared on completion, error, or abort.
   */
  protected timeoutTimer?: ReturnType<typeof setTimeout>;

  /**
   * When a timeout triggers the abort, this holds the TaskTimeoutError so
   * handleAbort() can surface the correct error type instead of a generic
   * TaskAbortedError.
   */
  protected pendingTimeoutError?: TaskTimeoutError;

  /**
   * Whether the streaming task runner should accumulate text-delta chunks and
   * emit an enriched finish event. Set from IRunConfig.shouldAccumulate.
   * Defaults to true so standalone task execution is backward-compatible.
   * The graph runner sets this to false when no downstream edge needs
   * materialized data (no cache, all downstream tasks are also streaming).
   */
  protected shouldAccumulate: boolean = true;

  /**
   * Active telemetry span for the current task run.
   */
  protected telemetrySpan?: ISpan;

  /**
   * Constructor for TaskRunner
   * @param task The task to run
   */
  constructor(task: ITask<Input, Output, Config>) {
    this.task = task;
    this.own = this.own.bind(this);
    this.handleProgress = this.handleProgress.bind(this);
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  /**
   * Runs the task and returns the output
   * @param overrides Optional input overrides
   * @param config Optional configuration overrides
   * @returns The task output
   */
  async run(overrides: Partial<Input> = {}, config: IRunConfig = {}): Promise<Output> {
    await this.handleStart(config);

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

      // Resolve config schema annotations (e.g. mcp-server references) by mutating task.config.
      // Always resolve from originalConfig so re-runs use the original string IDs, not
      // previously resolved objects. The original config is preserved for serialization.
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

      // Resolve schema-annotated inputs (models, repositories) before validation
      const schema = (this.task.constructor as typeof Task).inputSchema();
      this.task.runInputData = (await resolveSchemaInputs(
        this.task.runInputData as Record<string, unknown>,
        schema,
        { registry: this.registry }
      )) as Input;

      const inputs: Input = this.task.runInputData as Input;
      const isValid = await this.task.validateInput(inputs);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      if (this.abortController?.signal.aborted) {
        await this.handleAbort();
        throw new TaskAbortedError("Promise for task created and aborted before run");
      }

      let outputs: Output | undefined;

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

      const inputSchema = (this.task.constructor as typeof Task).inputSchema();
      const outputSchema = (this.task.constructor as typeof Task).outputSchema();
      const inputsForKey = this.outputCache
        ? await normalizeInputsForCacheKey(
            inputs as Record<string, unknown>,
            inputSchema as unknown as SchemaProperties,
          )
        : inputs;

      if (this.task.cacheable) {
        const cached = await this.outputCache?.getOutput(this.task.type, inputsForKey);
        if (cached !== undefined) {
          outputs = (await deserializeOutputPorts(
            cached as Record<string, unknown>,
            outputSchema as unknown as SchemaProperties,
          )) as Output;
          this.telemetrySpan?.addEvent("workglow.task.cache_hit");
          if (isStreamable) {
            this.task.runOutputData = outputs;
            this.task.emit("stream_start");
            this.task.emit("stream_chunk", { type: "finish", data: outputs } as StreamEvent);
            this.task.emit("stream_end", outputs);
          } else {
            this.task.runOutputData = outputs;
          }
        }
      }
      if (!outputs) {
        if (isStreamable) {
          outputs = await this.executeStreamingTask(inputs);
        } else {
          outputs = await this.executeTask(inputs);
        }
        if (this.task.cacheable && outputs !== undefined) {
          const wireOutputs = await serializeOutputPorts(
            outputs as Record<string, unknown>,
            outputSchema as unknown as SchemaProperties,
          );
          await this.outputCache?.saveOutput(this.task.type, inputsForKey, wireOutputs as Output);
        }
        this.task.runOutputData = outputs ?? ({} as Output);
      }

      await this.handleComplete();

      return this.task.runOutputData as Output;
    } catch (err: any) {
      await this.handleError(err);
      // If a timeout triggered the abort, throw the TaskTimeoutError instead
      // of the generic TaskAbortedError that the task's execute() may have thrown.
      throw this.task.error instanceof TaskTimeoutError ? this.task.error : err;
    }
  }

  /**
   * Runs the task in preview mode
   * @param overrides Optional input overrides
   * @returns The task output
   */
  public async runPreview(overrides: Partial<Input> = {}): Promise<Output> {
    if (this.task.status === TaskStatus.PROCESSING) {
      return this.task.runOutputData as Output;
    }

    this.task.setInput(overrides);

    // Resolve config schema annotations by mutating task.config directly
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

    // Resolve schema-annotated inputs (models, repositories) before validation
    const schema = (this.task.constructor as typeof Task).inputSchema();
    this.task.runInputData = (await resolveSchemaInputs(
      this.task.runInputData as Record<string, unknown>,
      schema,
      { registry: this.registry }
    )) as Input;

    await this.handleStartPreview();

    try {
      const inputs: Input = this.task.runInputData as Input;
      const isValid = await this.task.validateInput(inputs);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      const resultPreview = await this.executeTaskPreview(inputs);
      if (resultPreview !== undefined) {
        this.task.runOutputData = resultPreview;
      }

      await this.handleCompletePreview();
    } catch (err: any) {
      getLogger().debug("runPreview failed", { taskId: this.task.config?.id, error: err });
      await this.handleErrorPreview();
    } finally {
      return this.task.runOutputData as Output;
    }
  }

  /**
   * Async iterator producing preview outputs as upstream tasks stream
   * snapshots. Yields once immediately with the current preview state, then
   * once per upstream snapshot until all relevant upstream streams complete
   * (or the consumer breaks out of the loop).
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

  /**
   * Aborts task execution
   */
  public abort(): void {
    if (this.task.hasChildren()) {
      this.task.subGraph.abort();
    }
    this.abortController?.abort();
  }

  // ========================================================================
  // Protected methods
  // ========================================================================

  protected own<T extends Taskish<any, any>>(i: T): T {
    const task = ensureTask(i, { isOwned: true });
    this.task.subGraph.addTask(task);
    // Propagate parent registry and abort signal to owned ITask instances so
    // that calling task.run() on the returned value inherits this execution context.
    if (hasRunConfig(i)) {
      Object.assign(i.runConfig, {
        registry: this.registry,
        signal: this.abortController?.signal,
        resourceScope: this.resourceScope,
      });
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
   * Protected method to execute a task by delegating back to the task itself.
   */
  protected async executeTask(input: Input): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
    return result;
  }

  /**
   * Protected method for preview execution delegation
   */
  protected async executeTaskPreview(input: Input): Promise<Output | undefined> {
    return this.task.executePreview?.(input, { own: this.own });
  }

  /**
   * Executes a streaming task by consuming its executeStream() async iterable.
   *
   * When `shouldAccumulate` is true (default, set by graph runner when any downstream
   * edge needs materialized data, or when caching is on):
   *   - text-delta chunks are accumulated per-port into a Map
   *   - the raw finish event is NOT emitted; instead an enriched finish event is
   *     emitted with the accumulated text merged in, so downstream dataflows can
   *     materialize values without re-accumulating on their own
   *
   * When `shouldAccumulate` is false (set by graph runner when all downstream edges
   * are also streaming and no cache is needed):
   *   - all events including the raw finish are emitted as-is (pure pass-through)
   *   - no accumulation Map is maintained
   */
  protected async executeStreamingTask(input: Input): Promise<Output | undefined> {
    const streamMode: StreamMode = getOutputStreamMode(this.task.outputSchema());
    if (streamMode === "append") {
      const ports = getStreamingPorts(this.task.outputSchema());
      if (ports.length === 0) {
        throw new TaskError(
          `Task ${this.task.type} declares append streaming but no output port has x-stream: "append"`
        );
      }
    }
    if (streamMode === "object") {
      const ports = getStreamingPorts(this.task.outputSchema());
      if (ports.length === 0) {
        throw new TaskError(
          `Task ${this.task.type} declares object streaming but no output port has x-stream: "object"`
        );
      }
    }

    const accumulated = this.shouldAccumulate ? new Map<string, string>() : undefined;
    const accumulatedObjects = this.shouldAccumulate
      ? new Map<string, Record<string, unknown> | unknown[]>()
      : undefined;
    let chunkCount = 0;
    let finalOutput: Output | undefined;

    this.task.emit("stream_start");

    const stream = this.task.executeStream!(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      resourceScope: this.resourceScope,
      inputStreams: this.inputStreams,
    });

    for await (const event of stream) {
      chunkCount++;

      if (chunkCount === 1) {
        this.task.status = TaskStatus.STREAMING;
        this.task.emit("status", this.task.status);
      }

      // For snapshot events, update runOutputData BEFORE emitting stream_chunk
      // so listeners see the latest snapshot when they handle the event
      if (event.type === "snapshot") {
        this.task.runOutputData = event.data as Output;
      }

      switch (event.type) {
        case "text-delta": {
          if (accumulated) {
            accumulated.set(event.port, (accumulated.get(event.port) ?? "") + event.textDelta);
          }
          this.task.emit("stream_chunk", event as StreamEvent);
          const progress = Math.min(99, Math.round(100 * (1 - Math.exp(-0.05 * chunkCount))));
          await this.handleProgress(progress);
          break;
        }
        case "object-delta": {
          if (accumulatedObjects) {
            const existing = accumulatedObjects.get(event.port);
            if (Array.isArray(event.objectDelta)) {
              // Array delta: upsert items by `id` into accumulated array
              const arr: unknown[] = Array.isArray(existing) ? [...existing] : [];
              for (const item of event.objectDelta) {
                const itemObj = item as Record<string, unknown>;
                if (itemObj && typeof itemObj === "object" && "id" in itemObj) {
                  const idx = arr.findIndex(
                    (e) => (e as Record<string, unknown>).id === itemObj.id
                  );
                  if (idx >= 0) arr[idx] = item;
                  else arr.push(item);
                } else {
                  arr.push(item);
                }
              }
              accumulatedObjects.set(event.port, arr);
            } else {
              // Non-array (e.g. structured generation): replace semantics
              accumulatedObjects.set(event.port, event.objectDelta);
            }
          }
          // Update runOutputData with accumulated state so listeners see growing state
          this.task.runOutputData = {
            ...this.task.runOutputData,
            [event.port]: accumulatedObjects?.get(event.port) ?? event.objectDelta,
          } as Output;
          this.task.emit("stream_chunk", event as StreamEvent);
          const progress = Math.min(99, Math.round(100 * (1 - Math.exp(-0.05 * chunkCount))));
          await this.handleProgress(progress);
          break;
        }
        case "snapshot": {
          this.task.emit("stream_chunk", event as StreamEvent);
          const progress = Math.min(99, Math.round(100 * (1 - Math.exp(-0.05 * chunkCount))));
          await this.handleProgress(progress);
          break;
        }
        case "finish": {
          if (accumulated || accumulatedObjects) {
            // Emit an enriched finish event: merge accumulated deltas into
            // the finish payload so downstream dataflows get complete port data
            // without needing to re-accumulate themselves.
            const merged: Record<string, unknown> = { ...(event.data || {}) };
            if (accumulated) {
              for (const [port, text] of accumulated) {
                if (text.length > 0) merged[port] = text;
              }
            }
            if (accumulatedObjects) {
              for (const [port, obj] of accumulatedObjects) {
                merged[port] = obj;
              }
            }
            // For replace-mode streams, finish carries data: {} by convention.
            // Fall back to the last snapshot (runOutputData) so the final output
            // is not silently cleared when the finish payload is empty.
            if (streamMode === "replace" && Object.keys(merged).length === 0) {
              const lastSnapshot = this.task.runOutputData;
              if (lastSnapshot && Object.keys(lastSnapshot).length > 0) {
                finalOutput = lastSnapshot as Output;
                this.task.emit("stream_chunk", {
                  type: "finish",
                  data: lastSnapshot,
                } as StreamEvent);
                break;
              }
            }
            finalOutput = merged as unknown as Output;
            this.task.emit("stream_chunk", { type: "finish", data: merged } as StreamEvent);
          } else {
            // No accumulation: emit the raw finish event and use it directly
            finalOutput = event.data as Output;
            this.task.emit("stream_chunk", event as StreamEvent);
          }
          break;
        }
        case "error": {
          throw event.error;
        }
      }
    }

    // Check if the task was aborted during streaming
    if (this.abortController?.signal.aborted) {
      throw new TaskAbortedError("Task aborted during streaming");
    }

    if (finalOutput !== undefined) {
      this.task.runOutputData = finalOutput;
    }

    this.task.emit("stream_end", this.task.runOutputData as Output);

    return this.task.runOutputData as Output;
  }

  // ========================================================================
  // Protected Handlers
  // ========================================================================

  /**
   * Handles task start
   */
  protected async handleStart(config: IRunConfig = {}): Promise<void> {
    if (this.task.status === TaskStatus.PROCESSING) return;

    this.running = true;

    this.task.startedAt = new Date();
    this.task.progress = 0;
    this.task.status = TaskStatus.PROCESSING;

    this.abortController = new AbortController();
    this.abortController.signal.addEventListener("abort", () => {
      this.handleAbort();
    });

    const cache = config.outputCache ?? this.task.runConfig?.outputCache;
    if (cache === true) {
      let instance = globalServiceRegistry.get(TASK_OUTPUT_REPOSITORY);
      this.outputCache = instance;
    } else if (cache === false) {
      this.outputCache = undefined;
    } else if (cache instanceof TaskOutputRepository) {
      this.outputCache = cache;
    }

    // shouldAccumulate defaults to true (backward-compatible for standalone runs)
    this.shouldAccumulate = config.shouldAccumulate !== false;

    if (config.updateProgress) {
      this.updateProgress = config.updateProgress;
    }

    if (config.registry) {
      this.registry = config.registry;
    }

    if (config.resourceScope) {
      this.resourceScope = config.resourceScope;
    }

    // If a parent signal is provided (e.g. set by context.own()), link it so
    // that aborting the parent also aborts this task.
    // Listen first, then check — addEventListener on an already-aborted signal
    // does not fire, so checking .aborted after ensures we never miss an abort.
    if (config.signal) {
      const onAbort = () => this.abortController!.abort();
      config.signal.addEventListener("abort", onAbort, { once: true });
      if (config.signal.aborted) {
        config.signal.removeEventListener("abort", onAbort);
        this.abortController.abort();
        return;
      }
    }

    // Start timeout timer if configured (timeout is a design-time config property)
    const timeout = (this.task.config as Record<string, unknown>).timeout as number | undefined;
    if (timeout !== undefined && timeout > 0) {
      this.pendingTimeoutError = new TaskTimeoutError(timeout);
      this.timeoutTimer = setTimeout(() => {
        this.abort();
      }, timeout);
    }

    // Start telemetry span
    const telemetry = getTelemetryProvider();
    if (telemetry.isEnabled) {
      this.telemetrySpan = telemetry.startSpan("workglow.task.run", {
        attributes: {
          "workglow.task.type": this.task.type,
          "workglow.task.id": String(this.task.config.id),
          "workglow.task.cacheable": this.task.cacheable,
          "workglow.task.title": this.task.title || undefined,
        },
      });
    }

    this.task.emit("start");
    this.task.emit("status", this.task.status);
  }
  private updateProgress = async (
    _task: ITask,
    _progress: number,
    _message?: string,
    ..._args: any[]
  ) => {};

  protected async handleStartPreview(): Promise<void> {
    this.previewRunning = true;
  }

  /**
   * Clears the timeout timer if one is active.
   */
  protected clearTimeoutTimer(): void {
    if (this.timeoutTimer !== undefined) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
  }

  /**
   * Handles task abort
   */
  protected async handleAbort(): Promise<void> {
    if (this.task.status === TaskStatus.ABORTING) return;
    this.clearTimeoutTimer();
    this.task.status = TaskStatus.ABORTING;
    this.task.progress = 100;
    // Use the pending timeout error if the abort was triggered by a timeout
    this.task.error = this.pendingTimeoutError ?? new TaskAbortedError();
    this.pendingTimeoutError = undefined;

    if (this.telemetrySpan) {
      this.telemetrySpan.setStatus(SpanStatusCode.ERROR, "aborted");
      this.telemetrySpan.addEvent("workglow.task.aborted", {
        "workglow.task.error": this.task.error.message,
      });
      this.telemetrySpan.end();
      this.telemetrySpan = undefined;
    }

    // Call optional cleanup method for resource release
    if (typeof this.task.cleanup === "function") {
      try {
        await this.task.cleanup();
      } catch {
        // Cleanup errors are swallowed — abort must not throw from cleanup
      }
    }

    this.task.emit("abort", this.task.error);
    this.task.emit("status", this.task.status);
  }

  protected async handleAbortPreview(): Promise<void> {
    this.previewRunning = false;
  }

  /**
   * Handles task completion
   */
  protected async handleComplete(): Promise<void> {
    if (this.task.status === TaskStatus.COMPLETED) return;
    this.clearTimeoutTimer();
    this.pendingTimeoutError = undefined;

    this.task.completedAt = new Date();
    this.task.progress = 100;
    this.task.status = TaskStatus.COMPLETED;
    this.abortController = undefined;

    if (this.telemetrySpan) {
      this.telemetrySpan.setStatus(SpanStatusCode.OK);
      this.telemetrySpan.end();
      this.telemetrySpan = undefined;
    }

    this.task.emit("complete");
    this.task.emit("status", this.task.status);
  }

  protected async handleCompletePreview(): Promise<void> {
    this.previewRunning = false;
  }

  protected async handleDisable(): Promise<void> {
    if (this.task.status === TaskStatus.DISABLED) return;
    this.task.status = TaskStatus.DISABLED;
    this.task.progress = 100;
    this.task.completedAt = new Date();
    this.abortController = undefined;
    this.task.emit("disabled");
    this.task.emit("status", this.task.status);
  }

  public async disable(): Promise<void> {
    await this.handleDisable();
  }

  /**
   * Handles task error
   * @param err Error that occurred
   */
  protected async handleError(err: Error): Promise<void> {
    if (err instanceof TaskAbortedError) return this.handleAbort();
    if (this.task.status === TaskStatus.FAILED) return;
    this.clearTimeoutTimer();
    this.pendingTimeoutError = undefined;
    if (this.task.hasChildren()) {
      this.task.subGraph!.abort();
    }

    this.task.completedAt = new Date();
    this.task.progress = 100;
    this.task.status = TaskStatus.FAILED;
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
    this.abortController = undefined;

    if (this.telemetrySpan) {
      this.telemetrySpan.setStatus(SpanStatusCode.ERROR, this.task.error.message);
      this.telemetrySpan.setAttributes({ "workglow.task.error": this.task.error.message });
      this.telemetrySpan.end();
      this.telemetrySpan = undefined;
    }

    this.task.emit("error", this.task.error);
    this.task.emit("status", this.task.status);
  }

  protected async handleErrorPreview(): Promise<void> {
    this.previewRunning = false;
  }

  /**
   * Handles task progress update
   * @param progress Progress value (0-100)
   * @param args Additional arguments
   */
  protected async handleProgress(
    progress: number,
    message?: string,
    ...args: any[]
  ): Promise<void> {
    this.task.progress = progress;
    // Emit before graph-level work (e.g. pushOutputFromNodeToEdges) so listeners are not stalled.
    this.task.emit("progress", progress, message, ...args);
    await this.updateProgress(this.task, progress, message, ...args);
  }
}
