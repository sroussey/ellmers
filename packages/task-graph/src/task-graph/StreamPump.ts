/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import { getLogger } from "@workglow/util";
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

    // Guarded so a throwing listener on the (possibly bridged, cross-graph)
    // stream events can't propagate back into the source task's stream loop and
    // abort an otherwise-healthy run. Mirrors the guarded task_progress/
    // task_complete emits in RunScheduler.
    const onStreamStart = () => {
      try {
        this.graph.emit("task_stream_start", task.id);
      } catch (err) {
        getLogger().error("task_stream_start listener threw", { error: err });
      }
    };

    const onStreamChunk = (event: StreamEvent) => {
      try {
        this.graph.emit("task_stream_chunk", task.id, event);
      } catch (err) {
        getLogger().error("task_stream_chunk listener threw", { error: err });
      }
    };

    const onStreamEnd = (output: Record<string, any>) => {
      try {
        this.graph.emit("task_stream_end", task.id, output);
      } catch (err) {
        getLogger().error("task_stream_end listener threw", { error: err });
      }
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
    if (outputCache) return true;

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
        // Single teardown path: closes the controller and detaches every
        // listener this stream added. Invoked on normal stream_end AND on a
        // terminal task status (FAILED/COMPLETED), because StreamProcessor does
        // not emit stream_end on the error/abort path — without the status
        // fallback the controller and listeners would leak (and a downstream
        // consumer awaiting `done` would hang) on failed/aborted source tasks.
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
          task.off("stream_chunk", onChunk);
          task.off("stream_end", onEnd);
          task.off("status", onStatus);
        };
        const onChunk = (event: StreamEvent) => {
          try {
            if (portId !== undefined && StreamPump.isPortDelta(event) && event.port !== portId) {
              return;
            }
            // Phase events are not accumulated into dataflow edges per the
            // StreamTypes contract, so they must not be enqueued onto edge
            // streams; drop them here.
            if (event.type === "phase") {
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
          cleanup();
        };
        const onStatus = (status: TaskStatus) => {
          // Terminal statuses with no stream_end (error/abort -> FAILED, or a
          // completion that bypassed stream_end) must still release the stream.
          if (status === TaskStatus.FAILED || status === TaskStatus.COMPLETED) {
            cleanup();
          }
        };
        task.on("stream_chunk", onChunk);
        task.on("stream_end", onEnd);
        task.on("status", onStatus);
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
