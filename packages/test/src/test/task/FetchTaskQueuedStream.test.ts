/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IQueueStorage } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  wrapQueueStorage,
} from "@workglow/job-queue";
import { SqliteQueueStorage } from "@workglow/sqlite/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import type { StreamEvent } from "@workglow/task-graph";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import type { FetchUrlTaskInput, FetchUrlTaskOutput } from "@workglow/tasks";
import { FetchUrlJob, FetchUrlTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import {
  Container,
  InMemoryCredentialStore,
  registerCredentialDefaults,
  ServiceRegistry,
  setGlobalCredentialStore,
  setLogger,
} from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const BODY = new Uint8Array([1, 2, 3, 4, 5]);

const mockFetch = vi.fn((_url: string, _options: RequestInit & { allowPrivate?: boolean }) =>
  Promise.resolve(
    new Response(new Blob([BODY]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(BODY.length),
      },
    })
  )
);
const mockSafeFetch: SafeFetchFn = (url, options) => mockFetch(url, options);

interface QueueFixture {
  readonly storage: IQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>;
  readonly server: JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput>;
  readonly client: JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>;
}

/**
 * Registers a server-attached queue under `queueName` so `FetchUrlTask`'s own
 * `resolveOrCreateQueue` finds this client/server pair instead of minting one,
 * which is what lets a test spy on `client.send`.
 */
async function registerQueue(
  queueName: string,
  storage: IQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>
): Promise<QueueFixture> {
  await storage.migrate();
  const { messageQueue, jobStore } = wrapQueueStorage(storage);
  const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput>(FetchUrlJob, {
    messageQueue,
    jobStore,
    queueName,
    pollIntervalMs: 1,
  });
  const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
    messageQueue,
    jobStore,
    queueName,
  });
  client.attach(server);
  getTaskQueueRegistry().registerQueue({ server, client, storage });
  return { storage, server, client };
}

function totalDeltaBytes(events: readonly StreamEvent[]): number {
  return events
    .filter((e) => e.type === "binary-delta")
    .reduce((n, e) => n + (e as { binaryDelta: Uint8Array }).binaryDelta.byteLength, 0);
}

describe("queued fetch streams over the job channel", () => {
  setLogger(getTestingLogger());
  let prevSafeFetch: SafeFetchFn;

  beforeAll(async () => {
    prevSafeFetch = registerSafeFetch(mockSafeFetch);
    await Sqlite.init();
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  beforeEach(async () => {
    mockFetch.mockClear();
    await setTaskQueueRegistry(null);
  });

  afterEach(async () => {
    await setTaskQueueRegistry(null);
  });

  // The delivery is the in-memory `job_stream` event, not the carrier, so the
  // same assertions must hold on a queue whose storage has no stream channel at
  // all. InMemoryQueueStorage implements `subscribeToStream` (the channel path);
  // SqliteQueueStorage does not (the server-attached fast path). Running both
  // is what makes the storage-independence claim testable rather than asserted.
  const backends: ReadonlyArray<{
    readonly name: string;
    readonly make: (queueName: string) => IQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>;
  }> = [
    {
      name: "InMemoryQueueStorage",
      make: (queueName) =>
        new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName),
    },
    {
      name: "SqliteQueueStorage",
      make: (queueName) =>
        new SqliteQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(
          new Sqlite.Database(":memory:"),
          queueName
        ),
    },
  ];

  for (const backend of backends) {
    test(`delivers binary deltas on body from an in-process worker (${backend.name})`, async () => {
      const queueName = `queued-stream-${backend.name}`;
      const { storage, server, client } = await registerQueue(queueName, backend.make(queueName));
      const sendSpy = vi.spyOn(client, "send");

      try {
        await server.start();

        const task = new FetchUrlTask({ queue: queueName });
        const seen: StreamEvent[] = [];
        task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

        const out = (await task.run({
          url: "https://example.com/f.bin",
          response_type: "stream",
        })) as FetchUrlTaskOutput;

        // The job really went through the queue — an inline run would emit the
        // same deltas, so without this the assertions below prove nothing.
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(await storage.size(JobStatus.COMPLETED)).toBe(1);

        const deltas = seen.filter((e) => e.type === "binary-delta");
        expect(deltas.length).toBeGreaterThan(0);
        expect(totalDeltaBytes(seen)).toBe(BODY.length);
        expect(deltas.every((e) => e.port === "body")).toBe(true);
        expect(out.metadata?.status).toBe(200);
      } finally {
        await server.stop();
        await storage.deleteAll();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // SECURITY: `prepareJobInput` bakes the resolved secret into `headers`, and a
  // queued payload is persisted durably. The refusal must therefore fire before
  // `client.send`, on the path a run actually takes — `executeStream`.
  // ---------------------------------------------------------------------------
  test("refuses a credentialled queued run before anything is sent", async () => {
    const SECRET = "sk-super-secret-value-1234567890";
    const CREDENTIAL_KEY = "queued-stream-credential";
    const queueName = "queued-stream-credential-queue";
    const { storage, server, client } = await registerQueue(
      queueName,
      new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName)
    );
    const sendSpy = vi.spyOn(client, "send");

    try {
      const registry = new ServiceRegistry(new Container());
      registerCredentialDefaults(registry);
      const store = new InMemoryCredentialStore();
      await store.put(CREDENTIAL_KEY, SECRET);
      setGlobalCredentialStore(store, registry);

      const task = new FetchUrlTask({ queue: queueName });
      const error = await task
        .run({ url: "https://api.example.com/data", credential_key: CREDENTIAL_KEY }, { registry })
        .catch((e: unknown) => e);

      // The leak assertions first: they are the invariant under regression.
      // `send` is the durable-write boundary — the payload it is handed is the
      // one persisted — so "never called" is the strongest statement available,
      // and it does not depend on how long a completed row is retained.
      expect(sendSpy).not.toHaveBeenCalled();
      expect(await storage.size()).toBe(0);
      // And the request itself must never have been issued: a refusal that
      // still fetches has already spent the credential.
      expect(mockFetch).not.toHaveBeenCalled();

      const configError = (error as { cause?: unknown })?.cause ?? error;
      expect(String((configError as Error)?.message ?? "")).toContain("credential");
      expect(String((configError as Error)?.message ?? "")).not.toContain(SECRET);
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });

  // The conditional-request guard lives in exactly one place, so it must fire
  // for a queued run too — a 304 carries no body and the cache save would
  // overwrite the copy the 304 just certified as good.
  test("refuses a conditional request plus an output cache on the queued path", async () => {
    const queueName = "queued-stream-conditional-queue";
    const { storage, server, client } = await registerQueue(
      queueName,
      new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName)
    );
    const sendSpy = vi.spyOn(client, "send");

    try {
      const task = new FetchUrlTask({ queue: queueName });
      task.runConfig.outputCache = new InMemoryTaskOutputRepository();
      const error = await task
        .run({
          url: "https://example.com/big.zip",
          response_type: "stream",
          headers: { "If-None-Match": '"v1"' },
        })
        .catch((e: unknown) => e);

      expect(String(error)).toMatch(/conditional request/i);
      expect(sendSpy).not.toHaveBeenCalled();
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });
});
