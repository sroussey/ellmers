/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cache-hit stream replay must degrade, never break:
 *
 *  - a stored stream whose resolution THROWS (corrupt entry, broken backing)
 *    converts the hit into a miss and the task recomputes (FIX: lookup wraps
 *    the replay in the same guard as row decode);
 *  - when one port's ref fails to resolve — dangling OR throwing — every
 *    stream that DID open for the other ports is released via its iterator's
 *    `return()`, wherever it sits relative to the failure (a backing may hold
 *    a file handle per open stream).
 */

import type { CacheRef, StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import { makeCacheRef, Task, TaskOutputRepository, TaskStatus } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

setLogger(getTestingLogger());

/**
 * Row repo with riggable by-ref stream resolution: each `$ref` maps to a
 * factory that may return a stream, return `undefined` (dangling), or throw
 * (corrupt). No streaming-sink surface, so fresh runs accumulate normally.
 */
class RiggedReplayRepo extends TaskOutputRepository {
  private rows = new Map<string, TaskOutput>();
  public readonly refStreams = new Map<string, () => AsyncIterable<Uint8Array> | undefined>();

  constructor() {
    super({ outputCompression: false });
  }
  override async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput) {
    this.rows.set(taskType + JSON.stringify(inputs), output);
  }
  override async getOutput(taskType: string, inputs: TaskInput) {
    return this.rows.get(taskType + JSON.stringify(inputs));
  }
  override async clear() {
    this.rows.clear();
  }
  override async size() {
    return this.rows.size;
  }
  override async clearOlderThan() {}
  override isDurable() {
    return false;
  }
  /** Replace every stored row's port values (used to plant refs post-run). */
  corruptRows(row: TaskOutput): void {
    for (const key of this.rows.keys()) this.rows.set(key, row);
  }
  override getOutputStreamByRef(ref: CacheRef): AsyncIterable<Uint8Array> | undefined {
    const factory = this.refStreams.get(ref.$ref);
    if (!factory) return undefined;
    return factory();
  }
  override async getOutputByRef(_ref: CacheRef): Promise<Blob | undefined> {
    return undefined; // no blob fallback — dangling refs stay dangling
  }
}

/** Async iterable that records whether any of its iterators saw `return()`. */
function trackedStream(bytes: Uint8Array): {
  iterable: AsyncIterable<Uint8Array>;
  wasReleased: () => boolean;
} {
  let released = false;
  const iterable: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: bytes };
        },
        async return(value?: unknown): Promise<IteratorResult<Uint8Array>> {
          released = true;
          done = true;
          return { done: true, value: value as Uint8Array };
        },
      };
    },
  };
  return { iterable, wasReleased: () => released };
}

type TwoPortOut = { text: string; bytes: Blob };

/**
 * Two delta ports so replay resolves multiple refs. Port order matters: the
 * failing/dangling port (`text`) comes FIRST in the schema, so the fulfilled
 * stream (`bytes`) sits AFTER the failure — the case the old release loop
 * missed entirely.
 */
class TwoPortStreamer extends Task<Record<string, never>, TwoPortOut> {
  public static override type = "CacheReplayFailure_TwoPort";
  public static override category = "Test";
  public static override cacheable = true;
  public static executions = 0;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
        bytes: { type: "object", format: "blob", "x-stream": "binary" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<TwoPortOut>> {
    TwoPortStreamer.executions++;
    yield { type: "text-delta", port: "text", textDelta: "fresh" };
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([7, 8]) };
    yield { type: "finish", data: {} as TwoPortOut };
  }
}

async function seedCorruptRow(
  repo: RiggedReplayRepo,
  badRef: CacheRef,
  okRef: CacheRef
): Promise<void> {
  // Run once so the row exists under the real cache key, then replace its
  // port values with the rigged refs.
  const seedTask = new TwoPortStreamer();
  await seedTask.run({}, { outputCache: repo });
  repo.corruptRows({ text: badRef, bytes: okRef });
}

describe("cache-hit stream replay failures degrade to a miss", () => {
  it("releases fulfilled streams on a DANGLING sibling ref, then recomputes", async () => {
    const repo = new RiggedReplayRepo();
    const badRef = makeCacheRef({ $ref: "rig://dangling", mode: "append", size: 5 });
    const okRef = makeCacheRef({ $ref: "rig://ok", mode: "binary", size: 2 });
    const tracked = trackedStream(new Uint8Array([1, 2]));
    repo.refStreams.set("rig://ok", () => tracked.iterable);
    // no entry for "rig://dangling" → resolves undefined (dangling).

    await seedCorruptRow(repo, badRef, okRef);
    const before = TwoPortStreamer.executions;

    const task = new TwoPortStreamer();
    const out = await task.run({}, { outputCache: repo, hasStreamingConsumers: true });

    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect(TwoPortStreamer.executions).toBe(before + 1); // miss → recompute
    expect(out.text).toBe("fresh");
    // The stream that DID open (after the dangling port) was released.
    expect(tracked.wasReleased()).toBe(true);
  });

  it("treats a THROWING resolution as a miss (releasing fulfilled streams) and recomputes", async () => {
    const repo = new RiggedReplayRepo();
    const badRef = makeCacheRef({ $ref: "rig://corrupt", mode: "append", size: 5 });
    const okRef = makeCacheRef({ $ref: "rig://ok2", mode: "binary", size: 2 });
    const tracked = trackedStream(new Uint8Array([3, 4]));
    repo.refStreams.set("rig://ok2", () => tracked.iterable);
    repo.refStreams.set("rig://corrupt", () => {
      throw new Error("corrupt stream row");
    });

    await seedCorruptRow(repo, badRef, okRef);
    const before = TwoPortStreamer.executions;

    const task = new TwoPortStreamer();
    const out = await task.run({}, { outputCache: repo, hasStreamingConsumers: true });

    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect(TwoPortStreamer.executions).toBe(before + 1); // degraded to miss
    expect(out.text).toBe("fresh");
    expect(tracked.wasReleased()).toBe(true);
  });
});
