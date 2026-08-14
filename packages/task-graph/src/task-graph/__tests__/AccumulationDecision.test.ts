/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { CACHE_REGISTRY, DefaultCacheRegistry } from "../../cache/CacheRegistry";
import { GraphAsTask } from "../../task/GraphAsTask";
import type { IExecuteContext } from "../../task/ITask";
import type { StreamEvent } from "../../task/StreamTypes";
import { Task } from "../../task/Task";
import { NonStreamingMemoryRepo, StreamingMemoryRepo } from "../../testing/StreamingMemoryRepo";
import { Dataflow } from "../Dataflow";
import { TaskGraph } from "../TaskGraph";

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

/** Records how many bytes it was asked to hold in the enriched finish event. */
class NonCacheableProducerTask extends Task<Record<string, never>, { bytes?: unknown }> {
  public static override type = "NonCacheableProducerTask";
  public static override category = "Test";
  public static override title = "Non-cacheable producer";
  public static override cacheable = false;
  public accumulatedRequested: boolean | undefined;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  public static override outputSchema(): DataPortSchema {
    return binOut;
  }
  override async *executeStream(): AsyncIterable<StreamEvent<{ bytes?: unknown }>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    yield { type: "finish", data: {} };
  }
  override async execute(): Promise<{ bytes?: unknown }> {
    throw new Error("unreachable");
  }
}

/** Same shape as {@link NonCacheableProducerTask} but writes a cache row. */
class CacheableProducerTask extends Task<Record<string, never>, { bytes?: unknown }> {
  public static override type = "CacheableProducerTask";
  public static override category = "Test";
  public static override title = "Cacheable producer";
  public static override cacheable = true;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  public static override outputSchema(): DataPortSchema {
    return binOut;
  }
  override async *executeStream(): AsyncIterable<StreamEvent<{ bytes?: unknown }>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([4, 5, 6, 7]) };
    yield { type: "finish", data: {} };
  }
  override async execute(): Promise<{ bytes?: unknown }> {
    throw new Error("unreachable");
  }
}

/** A non-cacheable streaming leaf: no dataflow edges when run alone in a subgraph. */
class LeafStreamTask extends Task<Record<string, never>, { bytes?: unknown }> {
  public static override type = "LeafStreamTask";
  public static override category = "Test";
  public static override title = "Leaf stream";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  public static override outputSchema(): DataPortSchema {
    return binOut;
  }
  override async *executeStream(): AsyncIterable<StreamEvent<{ bytes?: unknown }>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([8, 9]) };
    yield { type: "finish", data: {} };
  }
  override async execute(): Promise<{ bytes?: unknown }> {
    throw new Error("unreachable");
  }
}

class BinarySinkTask extends Task<{ bytes?: unknown }, { total: number }> {
  public static override type = "BinarySinkTask";
  public static override category = "Test";
  public static override title = "Binary sink";
  public static override cacheable = false;
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
  override async *executeStream(
    _input: { bytes?: unknown },
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<{ total: number }>> {
    let total = 0;
    const stream = context.inputStreams?.get("bytes");
    if (stream) {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done || value === undefined) break;
        if (value.type === "binary-delta") total += value.binaryDelta.byteLength;
      }
    }
    yield { type: "finish", data: { total } };
  }
  override async execute(): Promise<{ total: number }> {
    throw new Error("unreachable");
  }
}

describe("accumulation decision for a non-cacheable producer", () => {
  it("does not accumulate when a cache is present and every consumer takes the stream", async () => {
    const graph = new TaskGraph();
    const producer = new NonCacheableProducerTask({ id: "producer" });
    const sink = new BinarySinkTask({ id: "sink" });
    graph.addTask(producer);
    graph.addTask(sink);
    graph.addDataflow(new Dataflow("producer", "bytes", "sink", "bytes"));

    await graph.run(undefined, {
      noAccumulation: true,
      outputCache: new StreamingMemoryRepo({}),
    });

    // A non-cacheable task writes no row, so the cache must not force it to
    // buffer: the producer's own output carries no materialized bytes.
    const out = producer.runOutputData as Record<string, unknown>;
    expect(out.bytes).toBeUndefined();
    expect((sink.runOutputData as { total?: number }).total).toBe(3);
  });
});

describe("TaskRunner force-accumulate safety net: cacheable task, no sink, streaming consumer", () => {
  it("still accumulates so the cache row (and the result) is not written empty", async () => {
    // Driven directly through `task.runner.run()` (as StreamingAccumulation.test.ts's
    // shouldAccumulate tests do) rather than through a graph: a graph run would have
    // `taskNeedsAccumulation` decide the initial `shouldAccumulate` itself, and for a
    // cache that cannot stream at all, that decision already forces accumulation on
    // (both cache relaxations require `outputCache.supportsStreaming()`, so neither
    // applies and the trailing `return true` fires) — which would pass regardless of
    // TaskRunner's own safety net below, and so would not distinguish it from a buggy
    // one. Pinning `shouldAccumulate: false` and `hasStreamingConsumers: true` directly
    // isolates TaskRunner's independent force-accumulate branch instead, which is what
    // this guards: `refSinks` resolves to undefined for reasons the graph-level
    // decision cannot see (e.g. a private-policy task with no private cache slot
    // configured), and a downstream streaming consumer must not excuse a CACHEABLE
    // task from accumulating in that case — its cache row still gets written.
    const producer = new CacheableProducerTask({ id: "producer" });
    const cache = new NonStreamingMemoryRepo({});

    const result = await producer.runner.run(
      {},
      {
        outputCache: cache,
        shouldAccumulate: false,
        hasStreamingConsumers: true,
      }
    );

    const bytes = (result as { bytes?: unknown }).bytes;
    expect(bytes).toBeDefined();
    expect(new Uint8Array(bytes as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6, 7]));
  });
});

describe("GraphAsTask leaf accumulation: non-cacheable streaming leaf, cache registry present", () => {
  it("still accumulates the leaf so its own output is not written empty", async () => {
    // GraphAsTask.executeStream unconditionally passes `accumulateLeafOutputs: false`
    // into its subgraph run, and deliberately threads neither `registry` nor
    // `outputCache` into that call (documented on TaskRunner.streamRunOptions) — so
    // the ONLY way a cache registry reaches the leaf's own TaskRunner is the ambient
    // default, globalServiceRegistry. `hasMaterializingConsumers` /
    // `hasStreamingConsumers` are both computed from dataflow edges
    // (StreamPump.anyConsumerNeedsMaterialized / anyConsumerAcceptsStream), and a
    // leaf has zero outgoing edges, so BOTH read false regardless of whether a cache
    // is actually in play — a consumer-edge analysis cannot see this cache at all.
    //
    // Asserted on `leaf.runOutputData` directly rather than on `group.run()`'s
    // return value: GraphAsTask.executeStream separately forwards every ending
    // node's raw stream_chunk events (including the leaf's own binary-delta) as
    // its OWN stream, and the outer group's own `shouldAccumulate` (true by
    // default for this standalone run) re-accumulates those forwarded deltas
    // independently of whatever the leaf's own TaskRunner decided — which can
    // paper over a missing inner value non-deterministically (observed while
    // instrumenting this exact branch with a synchronous console.log: slowing
    // the run just enough visibly changed the outer merged result). The leaf's
    // own `runOutputData` is what the safety net actually controls, so it's the
    // only assertion this test needs.
    const leaf = new LeafStreamTask({ id: "leaf" });
    const sub = new TaskGraph();
    sub.addTask(leaf);
    const group = new GraphAsTask({ id: "group", subGraph: sub });

    const hadCacheRegistry = globalServiceRegistry.has(CACHE_REGISTRY);
    const previousCacheRegistry = hadCacheRegistry
      ? globalServiceRegistry.get(CACHE_REGISTRY)
      : undefined;
    globalServiceRegistry.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({ deterministic: new NonStreamingMemoryRepo({}) })
    );
    try {
      await group.run({});

      // The leaf's own output must not be written empty just because a cache
      // registry happens to be resolvable — no row is ever written for it (it
      // is non-cacheable), so the cache is irrelevant, and it is a LEAF (no
      // consumer at all), so nothing downstream takes the raw stream either.
      const bytes = (leaf.runOutputData as { bytes?: unknown }).bytes;
      expect(bytes).toBeDefined();
      expect(new Uint8Array(bytes as ArrayBuffer)).toEqual(new Uint8Array([8, 9]));
    } finally {
      if (hadCacheRegistry) {
        globalServiceRegistry.registerInstance(CACHE_REGISTRY, previousCacheRegistry!);
      } else {
        globalServiceRegistry.container.remove(CACHE_REGISTRY.id);
      }
    }
  });
});
