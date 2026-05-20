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

import type { CachePolicy, StreamEvent } from "@workglow/task-graph";
import {
  Dataflow,
  IExecuteContext,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { DataPortSchema } from "@workglow/util/schema";
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
