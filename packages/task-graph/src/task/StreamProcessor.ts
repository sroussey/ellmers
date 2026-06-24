/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import type { CacheRef } from "../cache/CacheRef";
import type { Taskish } from "../task-graph/Conversions";
import { BackpressureGate } from "./BackpressureGate";
import type { ITask } from "./ITask";
import type { StreamEvent, StreamMode } from "./StreamTypes";
import {
  assertBinaryFormat,
  DEFAULT_BINARY_HIGH_WATER_BYTES,
  foldObjectDelta,
  getOutputStreamMode,
  getStreamingPorts,
  materializeBinary,
} from "./StreamTypes";
import { TaskAbortedError, TaskError } from "./TaskError";
import type { TaskRunContext } from "./TaskRunContext";
import type { TaskInput, TaskOutput } from "./TaskTypes";
import { TaskStatus } from "./TaskTypes";

/**
 * Consumer for a port's binary-delta stream. The processor exposes chunks as
 * an async iterable; the sink returns the {@link CacheRef} the processor
 * places into `Output` at the port slot.
 *
 * Implementations are typically thin wrappers around
 * `TaskOutputRepository.saveOutputStream` — the runner supplies the wrapper
 * once it knows the cache key.
 */
export type BinaryRefSink = (chunks: AsyncIterable<Uint8Array>) => Promise<CacheRef>;

/**
 * Per-call run-state inputs shared by StreamProcessor.run. Bundles facade
 * state pulled at call time (registry, resourceScope, inputStreams) and
 * facade methods bound to the facade instance (onProgress, own).
 *
 * @internal
 */
export interface StreamProcessorDeps {
  readonly registry: ServiceRegistry;
  readonly resourceScope: ResourceScope | undefined;
  readonly inputStreams: Map<string, ReadableStream<StreamEvent>> | undefined;
  readonly onProgress: (
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ) => Promise<void>;
  readonly own: <T extends Taskish<any, any>>(i: T) => T;
  /**
   * Per-port binary-stream sinks. When a port has a sink registered, the
   * processor routes that port's `binary-delta` chunks to the sink (as an
   * async iterable) **instead** of accumulating them into a `Blob` /
   * `ArrayBuffer` in memory. At finish, the sink's returned {@link CacheRef}
   * replaces the port's slot in the output object — unless an explicit
   * binary finish payload is present for that port, which always wins
   * (artifact precedence: an explicit whole payload wins over a delta-built one).
   *
   * Ports without a sink follow the normal accumulation path.
   */
  readonly binaryRefSinks?: ReadonlyMap<string, BinaryRefSink>;
  /**
   * High-water mark (bytes) for the per-port binary stream router buffer. When
   * the buffered (un-consumed) byte total reaches or exceeds this value,
   * `BinaryStreamRouter.push()` returns a Promise that resolves only after the
   * consumer drains the buffer back below the mark. Defaults to
   * {@link DEFAULT_BINARY_HIGH_WATER_BYTES} when omitted.
   */
  readonly binaryHighWaterBytes?: number;
}

/**
 * @internal
 * Streaming event loop. Consumes a task's executeStream() output, manages
 * text/object delta accumulators, mode switching (append/object/replace),
 * and finish-event enrichment. Honors ctx.shouldAccumulate and
 * ctx.abortController.signal.
 */
export class StreamProcessor<Input extends TaskInput, Output extends TaskOutput> {
  constructor(private readonly task: ITask<Input, Output, any>) {}

  /**
   * A `replace`-mode stream finished with an empty payload and no preceding
   * snapshot — the producer delivered no value. Returning the empty object
   * would silently clear the output, so surface a clear error instead.
   */
  private replaceModeNoValueError(): TaskError {
    return new TaskError(
      `Task ${this.task.type} declares replace streaming but finished with no value: ` +
        `a replace-mode task must emit a final snapshot or a non-empty finish payload.`
    );
  }

  async run(
    input: Input,
    ctx: TaskRunContext,
    deps: StreamProcessorDeps
  ): Promise<Output | undefined> {
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

    const accumulated = ctx.shouldAccumulate ? new Map<string, string>() : undefined;
    const accumulatedObjects = ctx.shouldAccumulate
      ? new Map<string, Record<string, unknown> | unknown[]>()
      : undefined;
    const accumulatedBinary = ctx.shouldAccumulate ? new Map<string, Uint8Array[]>() : undefined;
    // Per-port routers: lazily created on the first binary-delta whose port has
    // a sink in `deps.binaryRefSinks`. Routes chunks to the sink instead of
    // accumulating in memory; at finish, awaits the sink's returned CacheRef
    // and writes it into the output at the port slot.
    const sinks = deps.binaryRefSinks;
    const highWaterMark =
      deps.binaryHighWaterBytes !== undefined && deps.binaryHighWaterBytes > 0
        ? deps.binaryHighWaterBytes
        : DEFAULT_BINARY_HIGH_WATER_BYTES;
    const routers = new Map<string, BinaryStreamRouter>();
    const ensureRouter = (port: string): BinaryStreamRouter | undefined => {
      if (!sinks) return undefined;
      const sink = sinks.get(port);
      if (!sink) return undefined;
      let r = routers.get(port);
      if (!r) {
        r = new BinaryStreamRouter(sink, highWaterMark);
        routers.set(port, r);
      }
      return r;
    };

    let streamingStarted = false;
    let finalOutput: Output | undefined;

    this.task.emit("stream_start");

    // Cooperative backpressure hook for executeStream() implementations that
    // emit through a side channel (not StreamProcessor's awaited `push`). When
    // any port has a router (we'd be applying byte-bounded backpressure on the
    // direct `binary-delta` path anyway), `await ctx.binaryBackpressure()`
    // waits until ALL active routers are at-or-below their high-water mark.
    // Without a router this is a cheap no-op.
    const binaryBackpressure = async (): Promise<void> => {
      if (routers.size === 0) return;
      const waits: Promise<void>[] = [];
      for (const r of routers.values()) {
        if (r._bufferedBytes >= r._highWaterMarkBytes) waits.push(r._awaitDrain());
      }
      if (waits.length === 0) return;
      await Promise.all(waits);
    };

    const stream = this.task.executeStream!(input, {
      signal: ctx.abortController.signal,
      updateProgress: deps.onProgress,
      own: deps.own,
      registry: deps.registry,
      resourceScope: deps.resourceScope,
      inputStreams: deps.inputStreams,
      binaryBackpressure,
    });

    try {
      for await (const event of stream) {
        // For snapshot events, update runOutputData BEFORE emitting stream_chunk
        // so listeners see the latest snapshot when they handle the event.
        if (event.type === "snapshot") {
          this.task.runOutputData = event.data as Output;
        }

        switch (event.type) {
          case "phase": {
            // Phase events are metadata: emit for observability, translate to a
            // progress event with optional progress + message, do NOT mutate
            // accumulators or runOutputData, do NOT flip status to STREAMING.
            this.task.emit("stream_chunk", event as StreamEvent);
            await deps.onProgress(event.progress, event.message);
            break;
          }
          case "text-delta": {
            if (!streamingStarted) {
              streamingStarted = true;
              this.task.status = TaskStatus.STREAMING;
              this.task.emit("status", this.task.status);
            }
            if (accumulated) {
              accumulated.set(event.port, (accumulated.get(event.port) ?? "") + event.textDelta);
            }
            this.task.emit("stream_chunk", event as StreamEvent);
            break;
          }
          case "object-delta": {
            if (!streamingStarted) {
              streamingStarted = true;
              this.task.status = TaskStatus.STREAMING;
              this.task.emit("status", this.task.status);
            }
            if (accumulatedObjects) {
              accumulatedObjects.set(
                event.port,
                foldObjectDelta(accumulatedObjects.get(event.port), event.objectDelta)
              );
            }
            // Update runOutputData with accumulated state so listeners see growing state
            this.task.runOutputData = {
              ...this.task.runOutputData,
              [event.port]: accumulatedObjects?.get(event.port) ?? event.objectDelta,
            } as Output;
            this.task.emit("stream_chunk", event as StreamEvent);
            break;
          }
          case "binary-delta": {
            if (!streamingStarted) {
              streamingStarted = true;
              this.task.status = TaskStatus.STREAMING;
              this.task.emit("status", this.task.status);
            }
            // Tee: when both a router AND an accumulator exist
            // for this port (graph context where the cache can stream but a
            // downstream edge needs the materialized value), push to BOTH —
            // router writes to the cache for the small ref-bearing Output,
            // accumulator drives the enriched finish event so edge consumers
            // still receive a Blob/ArrayBuffer.
            // `await router.push(...)` here is where byte-bounded backpressure
            // takes effect: the producer (executeStream) parks until the sink
            // drains the router buffer back under the high-water mark, or
            // until the router is closed (abort/error path).
            const router = ensureRouter(event.port);
            if (router) await router.push(event.binaryDelta);
            if (accumulatedBinary) {
              const arr = accumulatedBinary.get(event.port) ?? [];
              arr.push(event.binaryDelta);
              accumulatedBinary.set(event.port, arr);
            }
            this.task.emit("stream_chunk", event as StreamEvent);
            break;
          }
          case "snapshot": {
            if (!streamingStarted) {
              streamingStarted = true;
              this.task.status = TaskStatus.STREAMING;
              this.task.emit("status", this.task.status);
            }
            this.task.emit("stream_chunk", event as StreamEvent);
            break;
          }
          case "finish": {
            const hasEnrichment =
              accumulated !== undefined ||
              accumulatedObjects !== undefined ||
              accumulatedBinary !== undefined ||
              routers.size > 0;
            if (hasEnrichment) {
              // Emit an enriched finish event: merge accumulated deltas into
              // the finish payload so downstream dataflows get complete port data
              // without needing to re-accumulate themselves.
              const explicitPayload = (event.data || {}) as Record<string, unknown>;
              const merged: Record<string, unknown> = { ...explicitPayload };
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
              if (accumulatedBinary) {
                const outSchema = this.task.outputSchema();
                for (const [port, chunks] of accumulatedBinary) {
                  // Explicit binary finish payload wins. (Unlike text/object
                  // deltas above, which overwrite event.data, binary yields to
                  // an explicit payload — it's a whole artifact, not a partial.)
                  if (port in explicitPayload) continue;
                  const format = assertBinaryFormat(outSchema, port);
                  merged[port] = materializeBinary(chunks, format);
                }
              }
              // Close routers and collect refs. Explicit binary finish payload
              // still wins for the OUTPUT slot (artifact precedence); the
              // router's CacheRef is discarded in that case but the cache
              // write already happened.
              for (const router of routers.values()) router.end();
              const refs = new Map<string, CacheRef>();
              for (const [port, router] of routers) {
                if (port in explicitPayload) {
                  // Drain the promise so the sink doesn't leak; ignore the ref.
                  router.ref().catch(() => {});
                  continue;
                }
                refs.set(port, await router.ref());
              }
              // For replace-mode streams, finish carries data: {} by convention.
              // Fall back to the last snapshot (runOutputData) so the final output
              // is not silently cleared when the finish payload is empty —
              // overlaying router refs on top so cache-written bytes are not
              // orphaned (the ref still lands in the OUTPUT slot).
              if (streamMode === "replace" && Object.keys(merged).length === 0) {
                const lastSnapshot = this.task.runOutputData;
                if (lastSnapshot && Object.keys(lastSnapshot).length > 0) {
                  const snapshotWithRefs: Record<string, unknown> = { ...lastSnapshot };
                  for (const [port, ref] of refs) snapshotWithRefs[port] = ref;
                  finalOutput = snapshotWithRefs as Output;
                  this.task.emit("stream_chunk", {
                    type: "finish",
                    data: lastSnapshot,
                  } as StreamEvent);
                  break;
                }
                // No accumulated deltas, no explicit finish payload, and no
                // snapshot to fall back on — the producer never delivered a
                // value. A binary port may still have written a ref; only the
                // truly empty case is a bug.
                if (refs.size === 0) throw this.replaceModeNoValueError();
              }
              // The emitted finish event always carries the materialized payload
              // (from accumulators) so edge consumers see Blob/ArrayBuffer.
              // finalOutput diverges only when a router produced a ref for a
              // port that wasn't already pinned by an explicit payload — that
              // ref takes the slot in the return value so the queue/cache row
              // stays small (the tee path).
              this.task.emit("stream_chunk", { type: "finish", data: merged } as StreamEvent);
              if (refs.size === 0) {
                finalOutput = merged as unknown as Output;
              } else {
                const finalMerged: Record<string, unknown> = { ...merged };
                for (const [port, ref] of refs) finalMerged[port] = ref;
                finalOutput = finalMerged as unknown as Output;
              }
            } else {
              // No accumulation. For replace-mode streams the provider's finish
              // event carries `data: {}` by convention — the snapshots already
              // delivered the value, so the finish payload is intentionally
              // empty. Fall back to `runOutputData` (set on every snapshot above)
              // so we don't clobber the last snapshot with an empty object. This
              // mirrors the same fallback in the accumulation branch.
              const finishData = (event.data ?? {}) as Record<string, unknown>;
              if (streamMode === "replace" && Object.keys(finishData).length === 0) {
                const lastSnapshot = this.task.runOutputData;
                if (lastSnapshot && Object.keys(lastSnapshot).length > 0) {
                  finalOutput = lastSnapshot as Output;
                  this.task.emit("stream_chunk", {
                    type: "finish",
                    data: lastSnapshot,
                  } as StreamEvent);
                  break;
                }
                throw this.replaceModeNoValueError();
              }
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
    } catch (err) {
      // Surface the error to any in-flight router sinks so they reject
      // (rather than waiting forever on the producer). The original error is
      // rethrown unchanged.
      const failure = err instanceof Error ? err : new Error(String(err));
      for (const router of routers.values()) router.fail(failure);
      throw err;
    } finally {
      // Defensive: if the loop exited without seeing a `finish` event
      // (e.g. abort, generator return without yield), close routers so their
      // sinks see end-of-stream rather than blocking on the next chunk.
      for (const router of routers.values()) router.end();
    }

    // Check if the task was aborted during streaming
    if (ctx.abortController.signal.aborted) {
      throw new TaskAbortedError("Task aborted during streaming");
    }

    if (finalOutput !== undefined) {
      this.task.runOutputData = finalOutput;
    }

    this.task.emit("stream_end", this.task.runOutputData as Output);

    return this.task.runOutputData as Output;
  }
}

/**
 * Producer-consumer router used by {@link StreamProcessor} to forward a single
 * binary output port's `binary-delta` chunks to a {@link BinaryRefSink}. The
 * sink consumes the chunks via the async iterable and returns a
 * {@link CacheRef} that the processor places into `Output` at finish.
 *
 * Lifecycle: chunks pushed via `push()` are yielded to the sink in order.
 * `end()` signals end-of-stream (sink completes consumption, refPromise
 * resolves). `fail(err)` causes the iterable to throw on the next read
 * (refPromise rejects). `end()` and `fail()` are idempotent.
 *
 * Backpressure: byte-bounded. `push()` returns a Promise; the producer is
 * resolved immediately while the buffered (un-consumed) byte total stays
 * below `highWaterMarkBytes`, and parks until the consumer drains the
 * buffer back under the mark once the threshold is reached. `end()` and
 * `fail()` BOTH release any parked producer so an abort mid-park does not
 * leak the `push()` promise.
 */
export class BinaryStreamRouter {
  private readonly buffer: Uint8Array[] = [];
  /** Resolver for the consumer side (iterable awaiting next chunk). */
  private chunkNotify: (() => void) | undefined;
  private readonly refPromise: Promise<CacheRef>;
  /** Byte-bounded backpressure accounting + producer park/wake. */
  private readonly gate: BackpressureGate;

  constructor(sink: BinaryRefSink, highWaterMarkBytes: number) {
    this.gate = new BackpressureGate(highWaterMarkBytes);
    this.refPromise = sink(this.iterable());
    // Observe rejection so an unawaited refPromise (e.g. after fail() in an
    // error path) doesn't surface as an unhandled rejection. Subsequent
    // `await this.refPromise` still rejects.
    this.refPromise.catch(() => {});
  }

  /**
   * Buffer one chunk and return a Promise the caller must await. The promise
   * resolves immediately when buffered bytes remain under the high-water
   * mark, and otherwise parks until the consumer drains the buffer (or until
   * `end()` / `fail()` releases all parked callers).
   */
  push(chunk: Uint8Array): Promise<void> {
    if (this.gate.closed) return Promise.resolve();
    this.buffer.push(chunk);
    this.wakeChunk();
    return this.gate.charge(chunk.byteLength);
  }

  end(): void {
    // close() releases any producer parked at the high-water mark — abort
    // mid-stream would otherwise orphan the parked Promise. wakeChunk lets the
    // consumer iterable observe the close and return.
    this.gate.close();
    this.wakeChunk();
  }

  fail(err: Error): void {
    this.gate.fail(err);
    this.wakeChunk();
  }

  ref(): Promise<CacheRef> {
    return this.refPromise;
  }

  /** @internal Test hook: current buffered byte count (consumer-unread). */
  public get _bufferedBytes(): number {
    return this.gate._bufferedCost;
  }

  /** @internal Test hook: high-water mark in effect. */
  public get _highWaterMarkBytes(): number {
    return this.gate._highWaterMark;
  }

  /**
   * @internal Used by {@link IExecuteContext.binaryBackpressure} so a task
   * emitting via a side channel can park until the consumer drains. Resolves
   * immediately when the buffer is already under the mark or the router has
   * been closed.
   */
  public _awaitDrain(): Promise<void> {
    return this.gate.awaitBelowMark();
  }

  private wakeChunk(): void {
    const n = this.chunkNotify;
    this.chunkNotify = undefined;
    n?.();
  }

  private async *iterable(): AsyncIterable<Uint8Array> {
    while (true) {
      while (this.buffer.length > 0) {
        const chunk = this.buffer.shift()!;
        // Credit the gate as we hand the chunk to the sink; this wakes any
        // producer parked at the high-water mark once we drop below it. We
        // resolve as soon as we cross the threshold rather than waiting for the
        // buffer to drain fully — that keeps the producer pipelined.
        this.gate.credit(chunk.byteLength);
        yield chunk;
      }
      if (this.gate.failure) throw this.gate.failure;
      if (this.gate.closed) return;
      await new Promise<void>((res) => {
        this.chunkNotify = res;
      });
    }
  }
}
