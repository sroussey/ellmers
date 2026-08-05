/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stress tests for the streaming layer covering high event rates, abort
 * responsiveness, fan-out, and error propagation.
 *
 * These tests exercise behaviour that is difficult to observe in ordinary
 * streaming tests:
 *   - A producer generator that yields thousands of events in a tight loop
 *     must deliver every event without dropping or reordering.
 *   - AsyncIterable is pull-based, so an abort signal must stop the producer
 *     promptly rather than after the generator has drained on its own.
 *   - Fan-out via engine-internal ReadableStream.tee() must deliver identical
 *     event sequences to every downstream consumer.
 *   - A StreamError event mid-stream must fail the source task and prevent
 *     downstream tasks from starting.
 */

import type {
  BinaryRefSink,
  CachePolicy,
  CacheRef,
  IExecuteContext,
  StreamEvent,
  StreamSink,
} from "@workglow/task-graph";
import {
  Dataflow,
  isCacheRef,
  makeCacheRef,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

setLogger(getTestingLogger());

// ============================================================================
// Test tasks
// ============================================================================

type PromptInput = { prompt: string };
type TextOutput = { text: string };

/**
 * Streaming producer that yields `totalEvents` text-delta events in a tight
 * async generator loop, then a finish event. Exposes `yieldCount` so tests
 * can observe how far the generator progressed before abort.
 */
class HighRateProducer extends Task<PromptInput, TextOutput> {
  public static override type = "StreamingBackpressure_HighRateProducer";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public totalEvents: number;
  public yieldCount = 0;

  constructor(config: { id: string; totalEvents: number }) {
    super({ id: config.id, defaults: { prompt: "" } });
    this.totalEvents = config.totalEvents;
  }

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: PromptInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    try {
      for (let i = 0; i < this.totalEvents; i++) {
        if (context.signal.aborted) return;
        this.yieldCount++;
        yield { type: "text-delta", port: "text", textDelta: `${i}|` };
      }
      yield { type: "finish", data: {} as TextOutput };
    } finally {
      // `finally` runs when the consumer stops iterating (abort, throw, return)
      // so resource cleanup in real tasks is guaranteed.
    }
  }

  override async execute(_input: PromptInput): Promise<TextOutput | undefined> {
    return { text: expectedAccumulatedText(this.totalEvents) };
  }
}

function expectedAccumulatedText(totalEvents: number): string {
  let out = "";
  for (let i = 0; i < totalEvents; i++) out += `${i}|`;
  return out;
}

/**
 * Non-streaming downstream consumer: receives fully-materialised text from
 * an upstream streaming producer and returns it unchanged.
 */
class MaterialisedConsumer extends Task<{ text: string }, TextOutput> {
  public static override type = "StreamingBackpressure_MaterialisedConsumer";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", default: "" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { text: string }): Promise<TextOutput | undefined> {
    return { text: input.text ?? "" };
  }
}

/**
 * Producer that yields `preErrorEvents` text-deltas and then a StreamError.
 */
class ErroringProducer extends Task<PromptInput, TextOutput> {
  public static override type = "StreamingBackpressure_ErroringProducer";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public preErrorEvents: number;
  public readonly errorMessage = "producer failed mid-stream";

  constructor(config: { id: string; preErrorEvents: number }) {
    super({ id: config.id, defaults: { prompt: "" } });
    this.preErrorEvents = config.preErrorEvents;
  }

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: PromptInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    for (let i = 0; i < this.preErrorEvents; i++) {
      yield { type: "text-delta", port: "text", textDelta: "x" };
    }
    yield { type: "error", error: new Error(this.errorMessage) };
  }

  override async execute(_input: PromptInput): Promise<TextOutput | undefined> {
    throw new Error(this.errorMessage);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Streaming backpressure and stress", () => {
  describe("High-rate event delivery", () => {
    it("delivers 10,000 text-delta events in order with no drops", async () => {
      const graph = new TaskGraph();
      const totalEvents = 10_000;
      const producer = new HighRateProducer({ id: "producer", totalEvents });
      const consumer = new MaterialisedConsumer({ id: "consumer" });

      graph.addTasks([producer, consumer]);
      graph.addDataflow(new Dataflow("producer", "text", "consumer", "text"));

      const chunkEvents: StreamEvent[] = [];
      producer.on("stream_chunk", (event: StreamEvent) => chunkEvents.push(event));

      const runner = new TaskGraphRunner(graph);
      await runner.runGraph({ prompt: "" });

      expect(producer.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // Producer yielded exactly `totalEvents` deltas.
      expect(producer.yieldCount).toBe(totalEvents);

      // Every delta plus one finish were observed by the task.
      const deltaEvents = chunkEvents.filter((e) => e.type === "text-delta");
      const finishEvents = chunkEvents.filter((e) => e.type === "finish");
      expect(deltaEvents.length).toBe(totalEvents);
      expect(finishEvents.length).toBe(1);

      // Deltas arrived in strict index order (order-sensitive payloads).
      const expectedDeltas = Array.from({ length: totalEvents }, (_, i) => `${i}|`);
      const observedDeltas = deltaEvents.map((e) => (e as { textDelta: string }).textDelta);
      expect(observedDeltas).toEqual(expectedDeltas);

      // Accumulated text materialised correctly for the downstream consumer.
      const consumerOutput = consumer.runOutputData as TextOutput;
      expect(consumerOutput.text).toBe(expectedDeltas.join(""));
    });
  });

  describe("Abort responsiveness", () => {
    it("stops the producer generator promptly when the runner is aborted", async () => {
      const graph = new TaskGraph();
      const totalEvents = 100_000; // deliberately huge so abort must short-circuit
      const producer = new HighRateProducer({ id: "producer", totalEvents });
      const consumer = new MaterialisedConsumer({ id: "consumer" });

      graph.addTasks([producer, consumer]);
      graph.addDataflow(new Dataflow("producer", "text", "consumer", "text"));

      const runner = new TaskGraphRunner(graph);

      // Attach the status listener BEFORE starting the run so we cannot
      // miss the PROCESSING/STREAMING transition. Short-circuit if the
      // producer has already reached STREAMING, and time out defensively.
      const streamingPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          producer.off("status", onStatus);
          reject(new Error("Timed out waiting for producer to reach STREAMING"));
        }, 5_000);

        const onStatus = (s: TaskStatus) => {
          if (s === TaskStatus.STREAMING) {
            clearTimeout(timeout);
            producer.off("status", onStatus);
            resolve();
          }
        };
        producer.on("status", onStatus);

        if (producer.status === TaskStatus.STREAMING) {
          clearTimeout(timeout);
          producer.off("status", onStatus);
          resolve();
        }
      });

      const runPromise = runner.runGraph({ prompt: "" });
      await streamingPromise;

      const yieldCountAtAbort = producer.yieldCount;
      runner.abort();

      try {
        await runPromise;
      } catch {
        // Abort errors are expected.
      }

      // The producer generator halted instead of draining to `totalEvents`.
      expect(producer.yieldCount).toBeLessThan(totalEvents);

      // At most a small number of additional events slipped through between
      // the abort call and the next signal check in the generator.
      expect(producer.yieldCount - yieldCountAtAbort).toBeLessThan(1_000);

      // Producer ends up in an abort-adjacent state, not COMPLETED.
      expect([TaskStatus.ABORTING, TaskStatus.FAILED]).toContain(producer.status);

      // Downstream consumer never reaches COMPLETED for a valid result.
      expect(consumer.status).not.toBe(TaskStatus.COMPLETED);
    });
  });

  describe("Fan-out", () => {
    it("delivers identical event sequences to every downstream consumer", async () => {
      const graph = new TaskGraph();
      const totalEvents = 1_000;
      const producer = new HighRateProducer({ id: "producer", totalEvents });
      const consumerA = new MaterialisedConsumer({ id: "consumerA" });
      const consumerB = new MaterialisedConsumer({ id: "consumerB" });
      const consumerC = new MaterialisedConsumer({ id: "consumerC" });

      graph.addTasks([producer, consumerA, consumerB, consumerC]);
      graph.addDataflow(new Dataflow("producer", "text", "consumerA", "text"));
      graph.addDataflow(new Dataflow("producer", "text", "consumerB", "text"));
      graph.addDataflow(new Dataflow("producer", "text", "consumerC", "text"));

      const runner = new TaskGraphRunner(graph);
      await runner.runGraph({ prompt: "" });

      // Every consumer sees the identical, order-sensitive sequence.
      const expected = expectedAccumulatedText(totalEvents);
      for (const consumer of [consumerA, consumerB, consumerC]) {
        expect(consumer.status).toBe(TaskStatus.COMPLETED);
        const output = consumer.runOutputData as TextOutput;
        expect(output.text).toBe(expected);
      }
    });
  });

  describe("binary backpressure", () => {
    // Sized so a fast producer would overwhelm a slow sink: 100 chunks of 1 MiB
    // each = 100 MiB total, sink consumes one chunk every 50 ms (~5 s end-to-end).
    const CHUNK = 1024 * 1024;
    const CHUNKS = 100;
    const HIGH_WATER = 4 * 1024 * 1024;

    type BinOut = { bytes: Blob };

    /**
     * Streams `CHUNKS` × `CHUNK` bytes; awaits the producer-side `push`
     * promise so the byte-bounded backpressure check actually parks when the
     * router buffer reaches the high-water mark.
     */
    class FastBinaryProducer extends Task<Record<string, never>, BinOut> {
      public static override type = "StreamingBackpressure_FastBinaryProducer";
      public static override cachePolicy: CachePolicy = { kind: "none" };
      public static override cacheable = true;

      public static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {}, additionalProperties: false } as const;
      }
      public static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      async *executeStream(
        _input: Record<string, never>,
        _ctx: IExecuteContext
      ): AsyncIterable<StreamEvent<BinOut>> {
        for (let i = 0; i < CHUNKS; i++) {
          const chunk = new Uint8Array(CHUNK).fill(i & 0xff);
          yield { type: "binary-delta", port: "bytes", binaryDelta: chunk };
        }
        yield { type: "finish", data: {} as BinOut };
      }
    }

    it("keeps router buffer at-or-below the high-water mark while a slow sink drains", async () => {
      const router = await import("@workglow/task-graph");
      const { BinaryStreamRouter } = router as unknown as {
        BinaryStreamRouter: new (
          sink: BinaryRefSink,
          highWaterMarkBytes: number
        ) => {
          push(chunk: Uint8Array): Promise<void>;
          end(): void;
          ref(): Promise<CacheRef>;
          readonly _bufferedBytes: number;
        };
      };

      let observedPeak = 0;
      const consumed: number[] = [];
      const sink: BinaryRefSink = async (chunks) => {
        for await (const c of chunks) {
          consumed.push(c.byteLength);
          // Slow consumer: 50 ms per chunk.
          await new Promise((res) => setTimeout(res, 50));
        }
        return makeCacheRef({ $ref: "inmem://bp", size: consumed.reduce((a, b) => a + b, 0) });
      };

      const r = new BinaryStreamRouter(sink, HIGH_WATER);
      for (let i = 0; i < CHUNKS; i++) {
        const chunk = new Uint8Array(CHUNK).fill(i & 0xff);
        await r.push(chunk);
        observedPeak = Math.max(observedPeak, r._bufferedBytes);
      }
      r.end();
      const ref = await r.ref();

      // Peak buffer stayed at-or-below the high-water mark + at most one chunk
      // (the chunk that pushed us over the mark is counted before we park).
      expect(observedPeak).toBeLessThanOrEqual(HIGH_WATER + CHUNK);

      // Every byte was delivered.
      const totalDelivered = consumed.reduce((a, b) => a + b, 0);
      expect(totalDelivered).toBe(CHUNKS * CHUNK);
      expect(ref.size).toBe(CHUNKS * CHUNK);
      expect(isCacheRef(ref)).toBe(true);
    }, 30_000);

    it("releases a parked push() promise within 100ms when the router is ended (abort path)", async () => {
      const router = await import("@workglow/task-graph");
      const { BinaryStreamRouter } = router as unknown as {
        BinaryStreamRouter: new (
          sink: BinaryRefSink,
          highWaterMarkBytes: number
        ) => {
          push(chunk: Uint8Array): Promise<void>;
          end(): void;
          fail(err: Error): void;
          ref(): Promise<CacheRef>;
          readonly _bufferedBytes: number;
        };
      };

      // Sink starts consuming but the gate keeps it parked so the producer
      // buffer fills to the high-water mark. The orphaned-Promise bug pre-fix:
      // `end()` did not release the parked producer, so the test would
      // wait until the test-level timeout.
      let gateRelease: (() => void) | undefined;
      const gate = new Promise<void>((res) => {
        gateRelease = res;
      });
      const seen: Uint8Array[] = [];
      const sink: BinaryRefSink = async (chunks) => {
        await gate; // park the sink so the buffer stays full
        for await (const c of chunks) {
          seen.push(c);
        }
        return makeCacheRef({ $ref: "inmem://parked", size: 0 });
      };

      // High-water mark of 1 byte so a single non-empty chunk parks the next push.
      const r = new BinaryStreamRouter(sink, 1);
      // The first push parks immediately (1 byte >= 1-byte mark, no consumer).
      const parked = r.push(new Uint8Array([0xff]));

      let parkedResolved = false;
      parked.then(() => {
        parkedResolved = true;
      });

      // Park before measuring.
      await new Promise((res) => setTimeout(res, 10));
      expect(parkedResolved).toBe(false);

      const t0 = Date.now();
      r.end();
      await parked;
      const elapsed = Date.now() - t0;

      expect(parkedResolved).toBe(true);
      expect(elapsed).toBeLessThan(100);

      // Release the sink so the test exits cleanly.
      gateRelease?.();
      await r.ref();
      void seen;
    }, 10_000);

    it("runs a 100MiB stream end-to-end through StreamProcessor with byte-bounded backpressure", async () => {
      const producer = new FastBinaryProducer({ id: "producer" });

      let received = 0;
      const sink: BinaryRefSink = async (chunks) => {
        for await (const c of chunks) {
          received += c.byteLength;
          // Slow consumer — gives the producer time to outrun it without
          // bound if backpressure didn't apply. The byte-bounded invariant
          // itself is exercised directly in the BinaryStreamRouter unit
          // test above; here we verify the full StreamProcessor path
          // delivers every byte through the throttle without hangs or drops.
          await new Promise((res) => setTimeout(res, 2));
        }
        return makeCacheRef({ $ref: "inmem://e2e", size: received });
      };

      const processor = (producer as any).runner.streamProcessor as {
        run(input: any, ctx: any, deps: any): Promise<BinOut | undefined>;
      };
      const abortController = new AbortController();
      const ctx = {
        abortController,
        shouldAccumulate: false,
        telemetrySpan: undefined,
        dispose: () => {},
      } as any;
      const sinks: ReadonlyMap<string, StreamSink> = new Map([
        ["bytes", { mode: "binary", write: sink }],
      ]);

      const output = (await processor.run({}, ctx, {
        registry: undefined as any,
        resourceScope: undefined,
        inputStreams: undefined,
        onProgress: async () => {},
        own: <T>(t: T) => t,
        refSinks: sinks,
        streamHighWaterBytes: HIGH_WATER,
      })) as BinOut | undefined;

      expect(output).toBeDefined();
      // Every byte arrived; backpressure didn't drop chunks.
      expect(received).toBe(CHUNKS * CHUNK);
    }, 30_000);
  });

  describe("StreamError propagation", () => {
    it("fails the source task on a StreamError event and keeps downstream from completing", async () => {
      const graph = new TaskGraph();
      const producer = new ErroringProducer({ id: "producer", preErrorEvents: 500 });
      const consumer = new MaterialisedConsumer({ id: "consumer" });

      graph.addTasks([producer, consumer]);
      graph.addDataflow(new Dataflow("producer", "text", "consumer", "text"));

      const runner = new TaskGraphRunner(graph);

      let caught: unknown;
      try {
        await runner.runGraph({ prompt: "" });
      } catch (err) {
        caught = err;
      }

      // Either the graph throws, or the producer records the error on itself.
      const producerFailed = producer.status === TaskStatus.FAILED;
      const graphRejected = caught !== undefined;
      expect(producerFailed || graphRejected).toBe(true);

      // Downstream consumer must not claim a completed, valid result.
      expect(consumer.status).not.toBe(TaskStatus.COMPLETED);
    });
  });
});
