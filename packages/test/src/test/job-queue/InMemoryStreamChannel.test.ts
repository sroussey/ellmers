/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage, type StreamChunkRow } from "@workglow/job-queue";
import { uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("InMemoryQueueStorage stream channel", () => {
  let storage: InMemoryQueueStorage<Record<string, unknown>, Record<string, unknown>>;

  beforeEach(async () => {
    storage = new InMemoryQueueStorage(`stream-${uuid4()}`);
    await storage.migrate();
  });
  afterEach(async () => {
    await storage.deleteAll();
  });

  it("delivers live chunks in seq order to a subscriber", async () => {
    const seen: StreamChunkRow[] = [];
    const unsub = storage.subscribeToStream!("job1", 0, (r) => seen.push(r));
    // The carrier assigns seq (1, 2, …) — callers no longer pass it.
    await storage.publishStreamChunk!("job1", { type: "text-delta", port: "p", textDelta: "a" });
    await storage.publishStreamChunk!("job1", { type: "text-delta", port: "p", textDelta: "b" });
    unsub();
    expect(seen.map((r) => r.seq)).toEqual([1, 2]);
    expect(seen.map((r) => r.event.textDelta)).toEqual(["a", "b"]);
  });

  it("replays already-published chunks with seq > sinceSeq to a late subscriber", async () => {
    await storage.publishStreamChunk!("job2", { type: "text-delta", port: "p", textDelta: "a" }); // seq 1
    await storage.publishStreamChunk!("job2", { type: "text-delta", port: "p", textDelta: "b" }); // seq 2
    const seen: number[] = [];
    storage.subscribeToStream!("job2", 1, (r) => seen.push(r.seq)); // skip seq 1
    expect(seen).toEqual([2]);
  });

  it("isolates streams by job id", async () => {
    const a: number[] = [];
    storage.subscribeToStream!("jobA", 0, (r) => a.push(r.seq));
    await storage.publishStreamChunk!("jobB", { type: "finish", data: {} });
    expect(a).toEqual([]);
  });

  it("evicts a job's chunk log on delete", async () => {
    await storage.publishStreamChunk!("jobDel", { type: "finish", data: {} });
    await storage.delete("jobDel");
    const seen: number[] = [];
    storage.subscribeToStream!("jobDel", 0, (r) => seen.push(r.seq)); // log gone → no replay
    expect(seen).toEqual([]);
  });

  it("continues the per-job seq across attempts (a retry does not restart at 1)", async () => {
    const seen: number[] = [];
    storage.subscribeToStream!("retryJob", 0, (r) => seen.push(r.seq));
    // Attempt 1 (worker A) publishes two events...
    await storage.publishStreamChunk!("retryJob", {
      type: "text-delta",
      port: "p",
      textDelta: "a1",
    });
    await storage.publishStreamChunk!("retryJob", {
      type: "text-delta",
      port: "p",
      textDelta: "a2",
    });
    // ...the job retries and a DIFFERENT worker publishes the next event. Because
    // the carrier (not the worker) owns the counter, seq continues at 3 rather
    // than colliding with attempt 1's seq 1.
    await storage.publishStreamChunk!("retryJob", {
      type: "text-delta",
      port: "p",
      textDelta: "b1",
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});
