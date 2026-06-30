/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ITask } from "../task/ITask";
import type { StreamEvent, StreamMode } from "../task/StreamTypes";
import {
  edgeNeedsAccumulation,
  getOutputStreamMode,
  getPortStreamMode,
  getStreamingPorts,
} from "../task/StreamTypes";
import type { TaskInput } from "../task/TaskTypes";
import { TaskStatus } from "../task/TaskTypes";
import { Dataflow, DATAFLOW_ALL_PORTS } from "./Dataflow";
import type { EdgeMaterializer } from "./EdgeMaterializer";
import type { RunContext } from "./RunContext";
import type { RunScheduler } from "./RunScheduler";
import type { TaskGraph } from "./TaskGraph";
import type { GraphSingleTaskResult } from "./TaskGraphRunner";
import type { ITaskGraphScheduler } from "./TaskGraphScheduler";

/**
 * Per-call run-state inputs shared between {@link StreamPump.runStreamingTask}
 * and the helpers it calls. Keeps StreamPump stateless beyond `graph`,
 * `processScheduler`, and `edgeMaterializer` so the facade's mutable per-run
 * state (`registry`, `outputCache`, `resourceScope`, `accumulateLeafOutputs`)
 * is read at call time rather than captured at construction.
 *
 * @internal
 */
export interface StreamingRunOptions {
  readonly registry: ServiceRegistry;
  readonly outputCache: TaskOutputRepository | undefined;
  readonly resourceScope: ResourceScope | undefined;
  readonly accumulateLeafOutputs: boolean;
  /**
   * Opt-in to the no-accumulation passthrough path for this run. Off ⇒ every
   * edge takes today's drain; the flag only matters when an edge also meets the
   * passthrough conditions. Threaded onto each streaming task's run config so
   * the runner can choose the per-port ref-sink path.
   */
  readonly noAccumulation?: boolean;
  /** High-water mark (bytes) for the no-accumulation passthrough gate. */
  readonly streamHighWaterBytes?: number;
  readonly updateProgress: (
    task: ITask,
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ) => Promise<void>;
  /** Stable identifier for the current graph run; threaded into each task's IRunConfig. */
  readonly runId?: string;
  /**
   * True when the caller explicitly disabled caching (outputCache: false). When
   * set, `false` is passed to task.runner.run() so TaskRunner clears any stale
   * cacheRegistry rather than falling through to CACHE_REGISTRY resolution.
   */
  readonly legacyCacheExplicitlyDisabled?: boolean;
}

/**
 * @internal
 * Streaming bridge. Awaits upstream streaming inputs, runs streaming tasks,
 * tees stream events to downstream edges, decides accumulation policy.
 *
 * `awaitStreamInputs` and `runStreamingTask` take per-call run-state as
 * arguments rather than holding references, because the facade's per-run
 * state (`registry`, `outputCache`, `resourceScope`, `accumulateLeafOutputs`)
 * is mutable and may be reassigned between runs. Method-arg injection lets the
 * facade pass the current values at call time.
 *
 * The {@link RunScheduler} back-reference is wired post-construction via
 * {@link setRunScheduler} to break the StreamPump <-> RunScheduler import
 * cycle (StreamPump calls RunScheduler for status pushes; RunScheduler
 * dispatches into StreamPump indirectly via facade.runTask).
 */
export class StreamPump {
  // Set after construction (mutual reference) — see setRunScheduler.
  private runScheduler!: RunScheduler;

  constructor(
    private readonly graph: TaskGraph,
    private readonly processScheduler: ITaskGraphScheduler,
    private readonly edgeMaterializer: EdgeMaterializer
  ) {}

  /**
   * Wires the {@link RunScheduler} back-reference. Must be called once after
   * construction, before any call to {@link runStreamingTask}.
   */
  setRunScheduler(rs: RunScheduler): void {
    this.runScheduler = rs;
  }

  /**
   * Tees streaming inputs for a streamable task — one copy goes to the task's
   * executeStream() (via inputStreams), one stays on the edge for materialization
   * by awaitStreamInputs.
   */
  prepareStreamingInputs(task: ITask): void {
    const dataflows = this.graph.getSourceDataflows(task.id);
    const streamingEdges = dataflows.filter((df) => df.stream !== undefined);
    if (streamingEdges.length === 0) return;
    const inputStreams = new Map<string, ReadableStream<StreamEvent>>();
    for (const df of streamingEdges) {
      const stream = df.stream!;
      const [forwardCopy, materializeCopy] = stream.tee();
      inputStreams.set(df.targetTaskPortId, forwardCopy);
      df.setStream(materializeCopy);
    }
    task.runner.inputStreams = inputStreams;
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
  async awaitStreamInputs(
    task: ITask,
    registry: ServiceRegistry,
    noAccumulation: boolean = false
  ): Promise<void> {
    const dataflows = this.graph.getSourceDataflows(task.id);
    const streamingDataflows = dataflows.filter(
      (df) =>
        df.stream !== undefined &&
        // No-accumulation passthrough edges are NOT drained: the consumer takes
        // its data from the live stream (tee'd to executeStream) and its static
        // input slot holds the upstream per-port CacheRef. Draining here would
        // be the full-speed materialize that defeats edge backpressure.
        !StreamPump.isNoAccumulationPassthroughEdge(this.graph, df, noAccumulation)
    );
    if (streamingDataflows.length === 0) return;
    await Promise.all(
      streamingDataflows.map(async (df) => {
        await df.awaitStreamValue();
        // awaitStreamValue sets port data from the raw finish/snapshot event.
        // Apply the edge's transform chain over the materialised value so the
        // downstream task receives the transformed result. This is the sole
        // transform application for streaming edges (pushOutputFromNodeToEdges
        // deliberately skips them to avoid double-apply).
        await df.applyTransforms(registry);
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
  async runStreamingTask<T>(
    task: ITask,
    input: TaskInput,
    ctx: RunContext,
    options: StreamingRunOptions
  ): Promise<GraphSingleTaskResult<T>> {
    if (!this.runScheduler) {
      throw new Error(
        "StreamPump.runStreamingTask called before setRunScheduler — facade construction is incomplete."
      );
    }
    const streamMode = getOutputStreamMode(task.outputSchema());
    const shouldAccumulate = this.taskNeedsAccumulation(
      task,
      options.outputCache,
      options.accumulateLeafOutputs,
      options.noAccumulation === true
    );

    let streamingNotified = false;

    const onStatus = (status: TaskStatus) => {
      if (status === TaskStatus.STREAMING && !streamingNotified) {
        streamingNotified = true;
        this.runScheduler.pushStatusFromNodeToEdges(task, ctx, TaskStatus.STREAMING);
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
        // Pass false when explicitly disabled so TaskRunner clears stale state;
        // otherwise pass the legacy repo (or undefined to use CACHE_REGISTRY).
        outputCache: options.legacyCacheExplicitlyDisabled ? false : options.outputCache,
        shouldAccumulate,
        hasStreamingConsumers: StreamPump.anyConsumerAcceptsStream(this.graph, task),
        hasMaterializingConsumers: StreamPump.anyConsumerNeedsMaterialized(this.graph, task),
        updateProgress: options.updateProgress,
        registry: options.registry,
        resourceScope: options.resourceScope,
        runId: options.runId,
        noAccumulation: options.noAccumulation,
        streamHighWaterBytes: options.streamHighWaterBytes,
        // Sinks are installed regardless of downstream needs: when both an
        // accumulator and a router exist (downstream needs materialized + cache
        // can stream), StreamProcessor tees — accumulator drives the enriched
        // finish event for edge consumers; the router's CacheRef takes the
        // port slot in finalOutput so the queue/cache row stays small.
      });

      await this.edgeMaterializer.pushOutputFromNodeToEdges(task, results);

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
  private taskNeedsAccumulation(
    task: ITask,
    outputCache: TaskOutputRepository | undefined,
    accumulateLeafOutputs: boolean,
    noAccumulation: boolean = false
  ): boolean {
    if (outputCache) {
      // Relaxation: when the cache can ingest a byte stream, the task streams
      // ONLY binary, and no downstream edge needs the materialized value, the
      // bytes are piped straight to the cache sink instead of being buffered
      // into an enriched finish event. This is the memory win for large binary
      // outputs (e.g. file/image producers).
      if (StreamPump.canStreamBinaryToCache(this.graph, task, outputCache)) return false;
      // No-accumulation passthrough: under the opt-in flag, a cacheable task
      // whose streamable ports can each be sunk per-port (and no consumer needs
      // a materialized value) pipes every port straight to the cache, skipping
      // the enriched-finish buffer for all modes — the all-mode generalization
      // of the binary relaxation above.
      if (StreamPump.canStreamAllPortsToCache(this.graph, task, outputCache, noAccumulation)) {
        return false;
      }
      return true;
    }

    const outEdges = this.graph.getTargetDataflows(task.id);
    if (outEdges.length === 0) return accumulateLeafOutputs;

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
   * Decides whether a streaming task's binary output can be piped straight to a
   * stream-capable cache sink (skipping in-memory accumulation). True when:
   *
   * 1. The cache reports `supportsStreaming()` (NOT a `typeof saveOutputStream`
   *    duck-type — wrappers like `RunPrivateCacheRepo` always expose a concrete
   *    `saveOutputStream` but their `supportsStreaming()` reflects the BACKING
   *    repo, so the duck-type would falsely report `true` over a non-streaming
   *    backing store).
   * 2. The task's only streaming output port(s) are binary.
   * 3. No downstream dataflow edge needs the materialized value (every consumer
   *    accepts the raw binary stream, or there are no consumers).
   *
   * Exposed as a static (taking the graph explicitly) so the decision is
   * unit-testable in isolation from a live run.
   */
  static canStreamBinaryToCache(
    graph: TaskGraph,
    task: ITask,
    outputCache: TaskOutputRepository | undefined
  ): boolean {
    // Defensive: a repository may not implement `supportsStreaming` (the base
    // class does, but test doubles / partial mocks may not). Treat anything
    // that cannot affirmatively report streaming support as non-streaming.
    if (typeof outputCache?.supportsStreaming !== "function") return false;
    if (!outputCache.supportsStreaming()) return false;

    const outSchema = task.outputSchema();
    const streamingPorts = getStreamingPorts(outSchema);
    // Exactly ONE binary port: the cache sink contract keys bytes by
    // (taskType, inputs) with no port axis, so only a single port can pipe to
    // the cache. With accumulation skipped, any additional binary port would
    // have neither a sink nor an accumulator and its chunks would be silently
    // dropped — multi-port tasks must take the accumulation path instead.
    if (streamingPorts.length !== 1 || streamingPorts[0].mode !== "binary") return false;

    return !StreamPump.anyConsumerNeedsMaterialized(graph, task);
  }

  /**
   * All-mode analogue of {@link canStreamBinaryToCache} for the opt-in
   * no-accumulation path. True when the flag is on, the task is cacheable, the
   * cache implements the port-aware `saveOutputStreamPort`, every streaming
   * output port is a delta mode (`append` / `object` / `binary`), and no
   * downstream edge needs a materialized value. Then each port is sunk
   * independently (per-port {@link CacheRef}) and no enriched-finish buffer is
   * built. Cacheability is required because the per-port sinks are only built
   * for cacheable tasks; without them the deltas would have nowhere to go.
   */
  static canStreamAllPortsToCache(
    graph: TaskGraph,
    task: ITask,
    outputCache: TaskOutputRepository | undefined,
    noAccumulation: boolean
  ): boolean {
    if (!noAccumulation) return false;
    if (!task.cacheable) return false;
    if (typeof outputCache?.supportsStreamingPorts !== "function") return false;
    if (!outputCache.supportsStreamingPorts()) return false;
    const streamingPorts = getStreamingPorts(task.outputSchema());
    if (streamingPorts.length === 0) return false;
    const allDelta = streamingPorts.every(
      (p) => p.mode === "append" || p.mode === "object" || p.mode === "binary"
    );
    if (!allDelta) return false;
    return !StreamPump.anyConsumerNeedsMaterialized(graph, task);
  }

  /**
   * True when {@link df} is a no-accumulation passthrough edge: the flag is on,
   * the edge carries an active stream with no transforms, its source and target
   * ports declare the SAME delta stream mode (`append` / `object` / `binary`),
   * the source port fans out to this single consumer, and the target port does
   * not force stream validation (`x-validate-stream`). Such an edge skips the
   * materialize drain — the consumer reads the live stream and its static slot
   * holds the upstream {@link CacheRef}. Every other edge falls back to the
   * drain (correct, just no backpressure win).
   */
  static isNoAccumulationPassthroughEdge(
    graph: TaskGraph,
    df: Dataflow,
    noAccumulation: boolean
  ): boolean {
    if (!noAccumulation) return false;
    if (df.sourceTaskPortId === DATAFLOW_ALL_PORTS) return false;
    if (df.getTransforms().length > 0) return false;
    const source = graph.getTask(df.sourceTaskId);
    const target = graph.getTask(df.targetTaskId);
    if (!source || !target) return false;
    const srcMode = getPortStreamMode(source.outputSchema(), df.sourceTaskPortId);
    if (srcMode !== "append" && srcMode !== "object" && srcMode !== "binary") return false;
    if (getPortStreamMode(target.inputSchema(), df.targetTaskPortId) !== srcMode) return false;
    if (StreamPump.portForcesStreamValidation(target.inputSchema(), df.targetTaskPortId)) {
      return false;
    }
    // Single consumer of this source port: a fan-out source port must keep the
    // drain (the precise-pacing limitation is documented for multi-consumer).
    const fanout = graph
      .getTargetDataflows(df.sourceTaskId)
      .filter((e) => e.sourceTaskPortId === df.sourceTaskPortId);
    return fanout.length === 1;
  }

  /** Reads the per-port `x-validate-stream` opt-in from an input schema. */
  private static portForcesStreamValidation(
    schema: ReturnType<ITask["inputSchema"]>,
    port: string
  ): boolean {
    if (typeof schema === "boolean") return false;
    const prop = (schema.properties as Record<string, any>)?.[port];
    if (!prop || typeof prop === "boolean") return false;
    return prop["x-validate-stream"] === true;
  }

  /**
   * Returns `true` when any outgoing dataflow edge from {@link task} has a
   * target task whose input port can't consume the source's stream mode
   * directly (per {@link edgeNeedsAccumulation}). Independent of the cache —
   * used by the graph runner to decide whether to inhibit binary-stream sinks
   * on the source task's runner (refs can't survive across an edge whose
   * target expects a materialized value).
   *
   * Treats fan-out `*` edges as always-needs-materialized (conservative).
   */
  static anyConsumerNeedsMaterialized(graph: TaskGraph, task: ITask): boolean {
    const outSchema = task.outputSchema();
    const outEdges = graph.getTargetDataflows(task.id);
    return outEdges.some((df) => {
      if (df.sourceTaskPortId === DATAFLOW_ALL_PORTS) return true;
      const targetTask = graph.getTask(df.targetTaskId);
      if (!targetTask) return false;
      return edgeNeedsAccumulation(
        outSchema,
        df.sourceTaskPortId,
        targetTask.inputSchema(),
        df.targetTaskPortId
      );
    });
  }

  /**
   * Returns `true` when any outgoing dataflow edge targets an input port that
   * consumes the source port's binary stream mode directly (`x-stream:
   * "binary"` on both ends). Used to decide whether a cache hit should replay
   * cached bytes as `binary-delta` events: with no stream-capable consumer
   * the replay would be wasted reads. `*` fan-out edges don't count — their
   * consumers receive materialized values, not streams.
   */
  static anyConsumerAcceptsBinaryStream(graph: TaskGraph, task: ITask): boolean {
    const outSchema = task.outputSchema();
    return graph.getTargetDataflows(task.id).some((df) => {
      if (df.sourceTaskPortId === DATAFLOW_ALL_PORTS) return false;
      if (getPortStreamMode(outSchema, df.sourceTaskPortId) !== "binary") return false;
      const targetTask = graph.getTask(df.targetTaskId);
      if (!targetTask) return false;
      return getPortStreamMode(targetTask.inputSchema(), df.targetTaskPortId) === "binary";
    });
  }

  /**
   * All-mode analogue of {@link anyConsumerAcceptsBinaryStream}: `true` when any
   * outgoing edge targets an input port that consumes the source port's delta
   * stream mode directly (same `append` / `object` / `binary` mode on both
   * ends). Drives whether a cache hit replays the cached bytes as delta events
   * (via the per-mode codec) for a stream-capable consumer; `*` fan-out edges
   * don't count (their consumers receive materialized values).
   */
  static anyConsumerAcceptsStream(graph: TaskGraph, task: ITask): boolean {
    const outSchema = task.outputSchema();
    return graph.getTargetDataflows(task.id).some((df) => {
      if (df.sourceTaskPortId === DATAFLOW_ALL_PORTS) return false;
      const srcMode = getPortStreamMode(outSchema, df.sourceTaskPortId);
      if (srcMode !== "append" && srcMode !== "object" && srcMode !== "binary") return false;
      const targetTask = graph.getTask(df.targetTaskId);
      if (!targetTask) return false;
      return getPortStreamMode(targetTask.inputSchema(), df.targetTaskPortId) === srcMode;
    });
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
    edgesForGroup: ReadonlyArray<Dataflow>
  ): ReadableStream<StreamEvent> {
    return new ReadableStream<StreamEvent>({
      start: (controller) => {
        const onChunk = (event: StreamEvent) => {
          try {
            if (portId !== undefined && StreamPump.isPortDelta(event) && event.port !== portId) {
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
        const detach = () => {
          task.off("stream_chunk", onChunk);
          task.off("stream_end", onEnd);
          task.off("abort", onTerminate);
          task.off("error", onTerminate);
        };
        const onEnd = () => {
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
          detach();
        };
        // Abort/error never emit `stream_end` (the stream loop throws first),
        // so without these the edge stream would stay open forever and the
        // listeners would leak. Close gracefully — downstream materialization
        // settles on whatever events arrived; the task's own abort/error
        // already surfaces through the run.
        const onTerminate = () => {
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
          detach();
        };
        task.on("stream_chunk", onChunk);
        task.on("stream_end", onEnd);
        task.on("abort", onTerminate);
        task.on("error", onTerminate);
      },
    });
  }

  /**
   * Pushes stream events from a streaming task to its outgoing dataflow edges.
   * Creates per-port filtered ReadableStreams for specific-port edges and
   * unfiltered streams for DATAFLOW_ALL_PORTS edges. Within each port group,
   * uses tee() for fan-out to multiple consumers.
   */
  private pushStreamToEdges(task: ITask, _streamMode: StreamMode): void {
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
}
