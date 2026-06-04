/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ITask } from "../task/ITask";
import type { StreamEvent, StreamMode } from "../task/StreamTypes";
import { edgeNeedsAccumulation, getOutputStreamMode, getStreamingPorts } from "../task/StreamTypes";
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
  async awaitStreamInputs(task: ITask, registry: ServiceRegistry): Promise<void> {
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
      options.accumulateLeafOutputs
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
        updateProgress: options.updateProgress,
        registry: options.registry,
        resourceScope: options.resourceScope,
        runId: options.runId,
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
    accumulateLeafOutputs: boolean
  ): boolean {
    if (outputCache) {
      // Relaxation: when the cache can ingest a byte stream, the task streams
      // ONLY binary, and no downstream edge needs the materialized value, the
      // bytes are piped straight to the cache sink instead of being buffered
      // into an enriched finish event. This is the memory win for large binary
      // outputs (e.g. file/image producers).
      if (StreamPump.canStreamBinaryToCache(this.graph, task, outputCache)) return false;
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
   * unit-testable in isolation from a live run — mirroring
   * {@link StreamPump.pipeBinaryToCache}.
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
    const binaryOnly =
      streamingPorts.length > 0 && streamingPorts.every((p) => p.mode === "binary");
    if (!binaryOnly) return false;

    return !StreamPump.anyConsumerNeedsMaterialized(graph, task);
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
   * Drives a stream-capable cache sink from a streaming task's `binary-delta`
   * events. Returns an `{ promise, detach }` pair: `promise` resolves once the
   * cache's `saveOutputStream` has consumed every chunk (after the task emits
   * `stream_end`); `detach` removes the listeners. The chunk iterable is fed by
   * the task's `stream_chunk` events and closed on `stream_end`.
   *
   * Abort/error contract: `StreamProcessor` emits `stream_end` only on success
   * (it throws on abort/error before emitting it). To avoid a hang + listener
   * leak when the source task aborts or errors mid-stream, the iterable is also
   * terminated by the task's `abort`/`error` events and by an optional
   * `AbortSignal`. On any of those the
   * iterable ends gracefully so the sink can finalize the bytes seen so far —
   * the returned promise ALWAYS settles and `detach` ALWAYS runs.
   *
   * Exposed as a static so the assembly (binary-delta events → AsyncIterable →
   * `saveOutputStream`) is unit-testable in isolation from a graph run.
   */
  static pipeBinaryToCache(
    task: ITask,
    binaryPortId: string | undefined,
    sink: (chunks: AsyncIterable<Uint8Array>) => Promise<unknown>,
    signal?: AbortSignal
  ): { promise: Promise<void>; detach: () => void } {
    const queue: Uint8Array[] = [];
    let done = false;
    let notify: (() => void) | undefined;

    const wake = () => {
      const n = notify;
      notify = undefined;
      n?.();
    };

    const onChunk = (event: StreamEvent) => {
      if (event.type === "binary-delta") {
        if (binaryPortId === undefined || event.port === binaryPortId) {
          queue.push(event.binaryDelta);
          wake();
        }
      }
    };
    const onEnd = () => {
      done = true;
      wake();
    };
    // Abort/error termination: StreamProcessor never emits `stream_end` on these
    // paths, so without this the iterable would await forever. Terminate the
    // iterable (don't throw) so the sink finalizes the bytes seen so far and the
    // promise settles — the source's own abort/error already surfaces to the run.
    const onTerminate = () => {
      done = true;
      wake();
    };

    task.on("stream_chunk", onChunk);
    task.on("stream_end", onEnd);
    task.on("abort", onTerminate);
    task.on("error", onTerminate);
    if (signal) {
      if (signal.aborted) onTerminate();
      else signal.addEventListener("abort", onTerminate);
    }

    const detach = () => {
      task.off("stream_chunk", onChunk);
      task.off("stream_end", onEnd);
      task.off("abort", onTerminate);
      task.off("error", onTerminate);
      signal?.removeEventListener("abort", onTerminate);
    };

    async function* chunkIterable(): AsyncIterable<Uint8Array> {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (done) return;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    }

    // Discard the sink's return value (helper signals completion only; callers
    // wanting a CacheRef should hold the sink-returning promise themselves).
    const promise = sink(chunkIterable())
      .finally(detach)
      .then(() => undefined);
    return { promise, detach };
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
