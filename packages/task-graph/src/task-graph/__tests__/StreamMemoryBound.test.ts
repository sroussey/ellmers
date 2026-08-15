/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The memory bound itself, on a binary passthrough edge with no cache.
 *
 * Every other streaming test in this directory runs on payloads of a few
 * bytes, where a producer racing its consumer to completion is indistinguishable
 * from one paced to it. Here a producer emits a payload many times the
 * high-water mark into a deliberately slow sink and records its peak LEAD —
 * bytes it has emitted that the sink has not yet read, i.e. what the edge is
 * holding in memory at once. The whole point of the streaming path is that
 * this stays near the mark rather than near the payload.
 *
 * The second case is the control: the identical graph with the mark raised
 * above the whole payload. It pins that the producer really does outrun this
 * sink when nothing holds it back — so a bound observed in the first case is
 * the gate's doing and not an artifact of scheduling, of the sink happening to
 * be the faster of the two, or of the graph serialising the pair.
 */

import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { Dataflow, Task, TaskGraph } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

// 32 MiB in 64 KiB deltas against a 1 MiB mark: the payload is ~27x the bound
// asserted below, so a producer that is merely a little ahead and one that is
// unpaced are not close calls. The sink's per-chunk yield to the event loop is
// what costs time here, so the chunk COUNT is the runtime knob — 512 keeps both
// cases together near a second.
const CHUNK = 64 * 1024;
const CHUNKS = 512;
const TOTAL_BYTES = CHUNK * CHUNKS;
const HIGH_WATER = 1024 * 1024;

/**
 * Slack over the mark, in whole chunks: the delta that crossed the mark (the
 * gate is charged on enqueue, so it is already outstanding when the producer
 * parks), the one event the consumer-side wrapper prefetches, and the one in
 * flight between the credit and the sink's own counter.
 */
const PIPELINE_SLACK = 3 * CHUNK;

const binOut = {
  type: "object",
  properties: { bytes: { title: "Bytes", "x-stream": "binary", format: "binary" } },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const binIn = {
  type: "object",
  properties: { bytes: { title: "Bytes", "x-stream": "binary" } },
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Shared producer/consumer byte accounting for one run. `peakLead` is the
 * high-water mark of bytes emitted but not yet read — the quantity the gate
 * exists to bound.
 */
class ByteMeter {
  produced = 0;
  consumed = 0;
  peakLead = 0;
  noteProduced(bytes: number): void {
    this.produced += bytes;
    this.peakLead = Math.max(this.peakLead, this.produced - this.consumed);
  }
  noteConsumed(bytes: number): void {
    this.consumed += bytes;
  }
}

/**
 * Emits {@link TOTAL_BYTES} in {@link CHUNK}-sized binary deltas with no delay
 * of its own. `noteProduced` runs when the generator RESUMES after a yield —
 * i.e. once the streaming runtime has enqueued that delta onto the edge and
 * released the producer — so the recorded lead reflects whatever pacing was
 * applied, and reads zero pacing as a lead that grows to the whole payload.
 */
class BulkBinaryProducer extends Task<Record<string, never>, { bytes?: unknown }> {
  public static override type = "StreamMemoryBound_Producer";
  public static override category = "Test";
  public static override title = "Bulk binary producer";
  public static override cacheable = false;
  public meter: ByteMeter | undefined;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  public static override outputSchema(): DataPortSchema {
    return binOut;
  }
  async *executeStream(): AsyncIterable<StreamEvent<{ bytes?: unknown }>> {
    for (let i = 0; i < CHUNKS; i++) {
      yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array(CHUNK) };
      this.meter?.noteProduced(CHUNK);
    }
    yield { type: "finish", data: {} };
  }
  override async execute(): Promise<{ bytes?: unknown }> {
    throw new Error("unreachable");
  }
}

/**
 * Counts the bytes it reads, sleeping between reads. The sleep is a macrotask,
 * while the producer's own loop advances on microtasks: without pacing the
 * producer therefore drains its entire generator during a single one of these
 * sleeps, which is the failure this file measures.
 */
class SlowByteSink extends Task<{ bytes?: unknown }, { total: number }> {
  public static override type = "StreamMemoryBound_Sink";
  public static override category = "Test";
  public static override title = "Slow byte sink";
  public static override cacheable = false;
  public meter: ByteMeter | undefined;

  public static override inputSchema(): DataPortSchema {
    return binIn;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { total: { type: "number" } },
      additionalProperties: false,
    };
  }
  async *executeStream(
    _input: { bytes?: unknown },
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<{ total: number }>> {
    let total = 0;
    const stream = context.inputStreams?.get("bytes");
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || value === undefined) break;
          if (value.type === "binary-delta") {
            total += value.binaryDelta.byteLength;
            this.meter?.noteConsumed(value.binaryDelta.byteLength);
            await sleep(0);
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    yield { type: "finish", data: { total } };
  }
  override async execute(): Promise<{ total: number }> {
    throw new Error("unreachable");
  }
}

function buildGraph(meter: ByteMeter): {
  graph: TaskGraph;
  producer: BulkBinaryProducer;
  sink: SlowByteSink;
} {
  const graph = new TaskGraph();
  const producer = new BulkBinaryProducer({ id: "producer" });
  producer.meter = meter;
  const sink = new SlowByteSink({ id: "sink" });
  sink.meter = meter;
  graph.addTask(producer);
  graph.addTask(sink);
  graph.addDataflow(new Dataflow("producer", "bytes", "sink", "bytes"));
  return { graph, producer, sink };
}

describe("streaming memory bound under a slow consumer", () => {
  it("holds the producer's lead near the high-water mark, not near the payload", async () => {
    const meter = new ByteMeter();
    const { graph, producer, sink } = buildGraph(meter);

    await graph.run(undefined, {
      noAccumulation: true,
      outputCache: false,
      streamHighWaterBytes: HIGH_WATER,
    });

    expect((sink.runOutputData as { total?: number }).total).toBe(TOTAL_BYTES);
    expect(meter.consumed).toBe(TOTAL_BYTES);
    // The bound is what the feature buys: at most a mark's worth of bytes plus
    // the events already in the pipeline, never the whole payload.
    expect(meter.peakLead).toBeLessThanOrEqual(HIGH_WATER + PIPELINE_SLACK);
    // The other half of "never in memory as one value": nothing along the way
    // folded the payload back into a single port value on the producer either.
    expect((producer.runOutputData as { bytes?: unknown }).bytes).toBeUndefined();
    // A guard on the constants, not a measurement: the bound above says nothing
    // unless the payload it bounds is very much larger.
    expect(TOTAL_BYTES).toBeGreaterThan((HIGH_WATER + PIPELINE_SLACK) * 20);
  }, 20_000);

  it("without a reachable mark the same producer races the whole payload ahead", async () => {
    const meter = new ByteMeter();
    const { graph, sink } = buildGraph(meter);

    await graph.run(undefined, {
      noAccumulation: true,
      outputCache: false,
      // A mark the payload can never reach: the gate is installed on the same
      // edge and charged the same way, it simply never parks anyone.
      streamHighWaterBytes: TOTAL_BYTES * 2,
    });

    expect((sink.runOutputData as { total?: number }).total).toBe(TOTAL_BYTES);
    // Nothing about this graph paces the producer on its own: it emits every
    // chunk before the sink has read more than one.
    expect(meter.peakLead).toBeGreaterThan(TOTAL_BYTES - 4 * CHUNK);
  }, 20_000);
});
