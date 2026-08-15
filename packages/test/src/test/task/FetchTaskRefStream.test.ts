/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JobHandle } from "@workglow/job-queue";
import type { CacheRef, StreamEvent } from "@workglow/task-graph";
import {
  getTaskQueueRegistry,
  isCacheRef,
  makeCacheRef,
  setTaskQueueRegistry,
  TASK_OUTPUT_REPOSITORY,
} from "@workglow/task-graph";
import { StreamingMemoryRepo } from "@workglow/task-graph/test";
import type { FetchUrlTaskOutput } from "@workglow/tasks";
import { FetchUrlTask } from "@workglow/tasks";
import { globalServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const BODY = new Uint8Array([7, 8, 9]);

/**
 * A handle with no `onStream` is exactly what a cross-process carrier hands
 * back: no durable queue storage implements `subscribeToStream`, so the client
 * omits the member entirely and the bytes have to travel in the output.
 */
function registerChannellessQueue(queueName: string, output: unknown): void {
  const handle = {
    id: "ref-job",
    waitFor: async () => output,
    abort: async () => {},
    onProgress: () => () => {},
  } as unknown as JobHandle<FetchUrlTaskOutput>;
  getTaskQueueRegistry().registerQueue({
    server: { queueName, isRunning: () => true, start: async () => {}, stop: async () => {} },
    client: { send: async () => handle },
    storage: { deleteAll: async () => {} },
  } as any);
}

async function saveBody(repo: StreamingMemoryRepo, bytes: Uint8Array): Promise<CacheRef> {
  return repo.saveOutputStreamPort(
    "FetchUrlTask",
    { url: "https://example.com/f.bin" },
    "body",
    "binary",
    (async function* () {
      yield bytes;
    })(),
    {}
  );
}

function deltaBytes(events: readonly StreamEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.type !== "binary-delta") continue;
    for (const b of (e as { binaryDelta: Uint8Array }).binaryDelta) out.push(b);
  }
  return out;
}

async function binaryBytes(value: unknown): Promise<number[]> {
  if (value instanceof Blob) return Array.from(new Uint8Array(await value.arrayBuffer()));
  if (value instanceof Uint8Array) return Array.from(value);
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  return [];
}

function lastFinish(events: readonly StreamEvent[]): { data?: Record<string, unknown> } {
  const finish = events.filter((e) => e.type === "finish").at(-1);
  expect(finish).toBeDefined();
  return finish as { data?: Record<string, unknown> };
}

describe("out-of-process worker returns a CacheRef", () => {
  setLogger(getTestingLogger());

  beforeEach(async () => {
    await setTaskQueueRegistry(null);
  });

  afterEach(async () => {
    await setTaskQueueRegistry(null);
  });

  test("re-emits the referenced bytes as binary deltas", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await saveBody(repo, BODY);
    registerChannellessQueue("ref-queue", { body: ref, metadata: { status: 200 } });

    const task = new FetchUrlTask({ queue: "ref-queue" });
    task.runConfig.outputCache = repo;
    const seen: StreamEvent[] = [];
    task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

    const out = (await task.run({
      url: "https://example.com/f.bin",
      response_type: "stream",
    })) as FetchUrlTaskOutput;

    expect(deltaBytes(seen)).toEqual(Array.from(BODY));
    expect(out.metadata?.status).toBe(200);
    // Stripping the ref is what lets accumulation refill `body`. Left in place
    // it would not merely be redundant: StreamProcessor treats a port carried
    // by the finish payload as an artifact outranking both the accumulator and
    // this run's own cache-sink ref, so every consumer would receive the
    // worker's handle where the bytes belong.
    const finish = lastFinish(seen);
    expect(isCacheRef(finish.data?.["body"])).toBe(false);
    expect(await binaryBytes(finish.data?.["body"])).toEqual(Array.from(BODY));
  });

  // Reading `runConfig.outputCache: true` the way TaskRunner does — a run whose
  // cache comes from the global registry can reach the worker's bytes, and
  // refusing it would be a false alarm.
  test("resolves the ref through the globally registered repository", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await saveBody(repo, BODY);
    registerChannellessQueue("ref-queue-global", { body: ref, metadata: { status: 200 } });

    const previous = globalServiceRegistry.has(TASK_OUTPUT_REPOSITORY)
      ? globalServiceRegistry.get(TASK_OUTPUT_REPOSITORY)
      : undefined;
    globalServiceRegistry.registerInstance(TASK_OUTPUT_REPOSITORY, repo);
    try {
      const task = new FetchUrlTask({ queue: "ref-queue-global" });
      task.runConfig.outputCache = true;
      const seen: StreamEvent[] = [];
      task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

      await task.run({ url: "https://example.com/f.bin", response_type: "stream" });
      expect(deltaBytes(seen)).toEqual(Array.from(BODY));
    } finally {
      // ServiceRegistry has no unregister, so a slot that started empty stays
      // filled. Vitest isolates per file and every other test here supplies its
      // cache explicitly — only `outputCache === true` consults the registry —
      // so the leftover reaches nothing.
      if (previous !== undefined) {
        globalServiceRegistry.registerInstance(TASK_OUTPUT_REPOSITORY, previous);
      }
    }
  });

  // The bytes exist and this process cannot reach them. Reporting a fetch that
  // completed with an empty body is the failure the whole byte-source work
  // exists to prevent, so both unreachable shapes are loud.
  test("fails loudly when no cache can read the referenced body", async () => {
    const repo = new StreamingMemoryRepo({});
    const ref = await saveBody(repo, BODY);
    registerChannellessQueue("ref-queue-nocache", { body: ref, metadata: { status: 200 } });

    const task = new FetchUrlTask({ queue: "ref-queue-nocache" });
    const error = await task
      .run({ url: "https://example.com/f.bin", response_type: "stream" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/no output cache/i);
  });

  test("fails loudly when the referenced entry is gone", async () => {
    const repo = new StreamingMemoryRepo({});
    const dangling = makeCacheRef({
      $ref: "inmem://evicted",
      port: "body",
      mode: "binary",
      size: 3,
    });
    registerChannellessQueue("ref-queue-dangling", {
      body: dangling,
      metadata: { status: 200 },
    });

    const task = new FetchUrlTask({ queue: "ref-queue-dangling" });
    task.runConfig.outputCache = repo;
    const error = await task
      .run({ url: "https://example.com/f.bin", response_type: "stream" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/could not be read back/i);
  });

  // A derived-port response carries no `body` at all: the settled value IS the
  // whole result, there is no second copy of anything, and demanding a cache
  // for it would break every out-of-process `response_type: "text"` run.
  test("passes a settled output carrying no body straight through", async () => {
    registerChannellessQueue("ref-queue-derived", {
      text: "hello",
      metadata: { status: 200, contentType: "text/plain" },
    });

    const task = new FetchUrlTask({ queue: "ref-queue-derived" });
    const seen: StreamEvent[] = [];
    task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

    const out = (await task.run({
      url: "https://example.com/f.txt",
      response_type: "text",
    })) as FetchUrlTaskOutput;

    expect(out.text).toBe("hello");
    expect(deltaBytes(seen)).toEqual([]);
  });
});
