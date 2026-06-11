/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  Job,
  JobQueueClient,
  JobQueueServer,
  wrapQueueStorage,
} from "@workglow/job-queue";
import type { CacheRef } from "@workglow/task-graph";
import { makeJobOutputStreamResolver } from "@workglow/task-graph";
import { uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StreamingMemoryRepo } from "../../binding/StreamingMemoryRepo";

interface SInput {
  readonly [key: string]: unknown;
}
interface SOutput {
  readonly ok: true;
  readonly [key: string]: unknown;
}

const repo = new StreamingMemoryRepo({});

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

/**
 * Simulates the worker-side ref path: streams its payload into the shared
 * cache backing and completes with an Output carrying the CacheRef instead
 * of the bytes (small queue row).
 */
class RefProducingJob extends Job<SInput, SOutput> {
  public override async execute(input: SInput, _context: IJobExecuteContext): Promise<SOutput> {
    const file: CacheRef = await repo.saveOutputStream(
      "RefJob",
      { id: input.id },
      gen(new Uint8Array([10, 20]), new Uint8Array([30])),
      {}
    );
    const transcript: CacheRef = await repo.saveOutputStream(
      "RefJobTranscript",
      { id: input.id },
      gen(new Uint8Array([7])),
      {}
    );
    return { ok: true, file, transcript };
  }
}

describe("JobHandle.outputStream (capability-gated streaming result reads)", () => {
  let server: JobQueueServer<SInput, SOutput, RefProducingJob>;
  let storage: InMemoryQueueStorage<SInput, SOutput>;
  let queueName: string;
  let queueParts: ReturnType<typeof wrapQueueStorage<SInput, SOutput>>;

  beforeEach(async () => {
    await repo.clear();
    queueName = `test-outputstream-${uuid4()}`;
    storage = new InMemoryQueueStorage(queueName);
    await storage.migrate();
    queueParts = wrapQueueStorage(storage);
    server = new JobQueueServer<SInput, SOutput, RefProducingJob>(RefProducingJob, {
      messageQueue: queueParts.messageQueue,
      jobStore: queueParts.jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    await server.start();
  });

  afterEach(async () => {
    if (server) await server.stop();
    if (storage) await storage.deleteAll();
  });

  it("streams a completed job's binary output out of the cache by port", async () => {
    const client = new JobQueueClient<SInput, SOutput>({
      messageQueue: queueParts.messageQueue,
      jobStore: queueParts.jobStore,
      queueName,
      outputStreamResolver: makeJobOutputStreamResolver(repo),
    });
    client.attach(server);

    const handle = await client.send({ id: uuid4() });
    expect(typeof handle.outputStream).toBe("function");

    const stream = await handle.outputStream!("file");
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([10, 20, 30]);

    const transcript = await handle.outputStream!("transcript");
    expect(await collect(transcript!)).toEqual([7]);
  });

  it("rejects portless discovery when the output holds two refs", async () => {
    const client = new JobQueueClient<SInput, SOutput>({
      messageQueue: queueParts.messageQueue,
      jobStore: queueParts.jobStore,
      queueName,
      outputStreamResolver: makeJobOutputStreamResolver(repo),
    });
    client.attach(server);

    const handle = await client.send({ id: uuid4() });
    await expect(handle.outputStream!()).rejects.toThrow(/explicit port/);
  });

  it("is absent when the client has no outputStreamResolver", async () => {
    const client = new JobQueueClient<SInput, SOutput>({
      messageQueue: queueParts.messageQueue,
      jobStore: queueParts.jobStore,
      queueName,
    });
    client.attach(server);

    const handle = await client.send({ id: uuid4() });
    expect(handle.outputStream).toBeUndefined();
    await handle.waitFor();
  });
});
