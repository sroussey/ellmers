/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IQueueStorage, JobHandle, JobStreamListener } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  RetryableJobError,
  wrapQueueStorage,
} from "@workglow/job-queue";
import { SqliteQueueStorage } from "@workglow/sqlite/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
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
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const BODY = new Uint8Array([1, 2, 3, 4, 5]);

/**
 * A body that arrives in several chunks, each carrying a distinct byte value.
 * A single-chunk body cannot show that the drain loop preserves arrival order
 * (or that it drains at all), which is the property the whole binary port
 * depends on: a reordered body is corrupt in a way no length check notices.
 */
const CHUNKED_BODY: readonly Uint8Array[] = Array.from({ length: 8 }, (_, i) =>
  Uint8Array.from([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3])
);

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

interface ChunkedResponseOptions {
  /** Error the body after this many chunks have been enqueued. */
  readonly failAfterChunks?: number;
  /** Counter incremented as each chunk leaves the source. */
  readonly onProduce?: () => void;
}

function chunkedResponse(
  chunks: readonly Uint8Array[],
  options: ChunkedResponseOptions = {}
): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAfterChunks !== undefined && index >= options.failAfterChunks) {
        controller.error(new Error("socket hang up"));
        return;
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      options.onProduce?.();
      controller.enqueue(chunks[index++]);
    },
  });
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  if (options.failAfterChunks === undefined) {
    headers["content-length"] = String(chunks.reduce((n, c) => n + c.byteLength, 0));
  }
  return new Response(stream, { status: 200, headers });
}

type Responder = (
  url: string,
  options: RequestInit & { allowPrivate?: boolean }
) => Promise<Response>;

const singleChunkResponder: Responder = () =>
  Promise.resolve(
    new Response(new Blob([BODY]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(BODY.length),
      },
    })
  );

let responder: Responder = singleChunkResponder;

const mockFetch = vi.fn((url: string, options: RequestInit & { allowPrivate?: boolean }) =>
  responder(url, options)
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

/**
 * Registers a queue whose `send` hands back `handle`, so a test drives the
 * stream/settlement interleaving of `consumeJobStream` directly. The real
 * queue can produce neither an in-band `error` event (`FetchUrlJob` emits only
 * deltas) nor an event that lands after the job settled, and both are hazards
 * the adapter has to answer for.
 */
function registerStubQueue(queueName: string, handle: JobHandle<FetchUrlTaskOutput>): void {
  const server = {
    queueName,
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
  };
  const client = { send: async () => handle };
  const storage = { deleteAll: async () => {} };
  getTaskQueueRegistry().registerQueue({ server, client, storage } as any);
}

interface StubHandle {
  readonly handle: JobHandle<FetchUrlTaskOutput>;
  /** Resolves once the task has subscribed. */
  readonly listening: Promise<JobStreamListener>;
  readonly output: Promise<FetchUrlTaskOutput>;
  settle(value: FetchUrlTaskOutput): void;
  /** Rejects the settlement, with any reason — a falsy one included. */
  fail(reason: unknown): void;
}

function makeStubHandle(): StubHandle {
  let announceListener!: (listener: JobStreamListener) => void;
  const listening = new Promise<JobStreamListener>((resolve) => {
    announceListener = resolve;
  });
  let settle!: (value: FetchUrlTaskOutput) => void;
  let fail!: (reason: unknown) => void;
  const output = new Promise<FetchUrlTaskOutput>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Only `waitFor()` awaits this, and the adapter attaches its handler a turn
  // later; without a handler here a `fail()` would be an unhandled rejection
  // that terminates the run under Node's default policy.
  output.catch(() => {});
  const handle: JobHandle<FetchUrlTaskOutput> = {
    id: "stub-job",
    waitFor: () => output,
    abort: async () => {},
    onProgress: () => () => {},
    onStream: (listener: JobStreamListener) => {
      announceListener(listener);
      return () => {};
    },
  };
  return { handle, listening, output, settle, fail };
}

function executeContext(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
  } as unknown as IExecuteContext;
}

function totalDeltaBytes(events: readonly StreamEvent[]): number {
  return events
    .filter((e) => e.type === "binary-delta")
    .reduce((n, e) => n + (e as { binaryDelta: Uint8Array }).binaryDelta.byteLength, 0);
}

function deltaBytes(events: readonly StreamEvent[]): Uint8Array {
  return concatBytes(
    events
      .filter((e) => e.type === "binary-delta")
      .map((e) => (e as { binaryDelta: Uint8Array }).binaryDelta)
  );
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
    responder = singleChunkResponder;
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
      responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY));

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
        expect(deltas.length).toBeGreaterThan(1);
        expect(totalDeltaBytes(seen)).toBe(concatBytes(CHUNKED_BODY).length);
        // Bytes AND their order: a drain that shuffled the queue would still
        // satisfy the byte count.
        expect(Array.from(deltaBytes(seen))).toEqual(Array.from(concatBytes(CHUNKED_BODY)));
        expect(deltas.every((e) => e.port === "body")).toBe(true);
        expect(out.metadata?.status).toBe(200);
      } finally {
        await server.stop();
        await storage.deleteAll();
      }
    });

    // The job publishes an end-of-stream marker and waits for it, so it cannot
    // complete until every receiver has been handed it. That is what lets the
    // consumer end on the stream rather than guess from the completion signal
    // that no more bytes are coming — and it only holds if the marker is
    // really emitted, last, on this carrier.
    test(`emits a terminal stream marker after the last delta (${backend.name})`, async () => {
      const queueName = `queued-stream-marker-${backend.name}`;
      const { storage, server, client } = await registerQueue(queueName, backend.make(queueName));
      responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY));
      const published: string[] = [];
      client.on("job_stream", (_queue: string, _jobId: unknown, event: { type: string }) => {
        published.push(event.type);
      });

      try {
        await server.start();
        const task = new FetchUrlTask({ queue: queueName });
        await task.run({ url: "https://example.com/f.bin", response_type: "stream" });

        expect(published.filter((t) => t === "binary-delta").length).toBe(CHUNKED_BODY.length);
        expect(published.filter((t) => t === "finish")).toHaveLength(1);
        expect(published.at(-1)).toBe("finish");
      } finally {
        await server.stop();
        await storage.deleteAll();
      }
    });

    // A body of no bytes produces no delta and is still a complete delivery —
    // the job emits its terminal marker either way. So the undelivered-stream
    // check below must key on that marker and not on a delta count, which
    // would condemn this run as having received nothing.
    test(`does not mistake a zero-length body for an undelivered stream (${backend.name})`, async () => {
      const queueName = `queued-stream-empty-body-${backend.name}`;
      const { storage, server } = await registerQueue(queueName, backend.make(queueName));
      responder = () =>
        Promise.resolve(
          new Response(new Uint8Array(0), {
            status: 200,
            headers: { "content-type": "application/octet-stream", "content-length": "0" },
          })
        );

      try {
        await server.start();
        const task = new FetchUrlTask({ queue: queueName });
        const seen: StreamEvent[] = [];
        task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

        const out = (await task.run({
          url: "https://example.com/empty.bin",
          response_type: "stream",
        })) as FetchUrlTaskOutput;

        expect(out.metadata?.status).toBe(200);
        expect(totalDeltaBytes(seen)).toBe(0);
        expect(seen.at(-1)?.type).toBe("finish");
      } finally {
        await server.stop();
        await storage.deleteAll();
      }
    });
  }

  // A cross-process carrier hands back a handle with no `onStream` at all — no
  // durable queue storage implements `subscribeToStream` — so there is no
  // channel to adapt and the job's settled output is the entire delivery. It
  // still has to reach the consumer as the `finish`: dropping it would report a
  // fetch that produced nothing.
  test("passes a channel-less carrier's settled output through as the finish", async () => {
    const queueName = "queued-stream-channelless";
    const settled = {
      text: "hello",
      metadata: { status: 200, contentType: "text/plain" },
    } as FetchUrlTaskOutput;
    registerStubQueue(queueName, {
      id: "channelless-job",
      waitFor: async () => settled,
      abort: async () => {},
      onProgress: () => () => {},
    } as unknown as JobHandle<FetchUrlTaskOutput>);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

    const out = (await task.run({
      url: "https://example.com/f.txt",
      response_type: "text",
    })) as FetchUrlTaskOutput;

    expect(out.text).toBe("hello");
    expect(out.metadata?.status).toBe(200);
    expect(seen.filter((e) => e.type === "binary-delta")).toHaveLength(0);
    expect(seen.at(-1)?.type).toBe("finish");
  });

  // ...but the same carrier cannot serve `response_type: "stream"`. Those bytes
  // travel only as deltas, and the job's finish payload carries `metadata`
  // alone — so passing the settled output through would report a successful
  // fetch whose body is empty, which no length check or status code exposes.
  test("refuses response_type stream on a carrier with no stream channel", async () => {
    const queueName = "queued-stream-channelless-stream";
    const waitFor = vi.fn(async () => ({ metadata: { status: 200 } }) as FetchUrlTaskOutput);
    registerStubQueue(queueName, {
      id: "channelless-stream-job",
      waitFor,
      abort: async () => {},
      onProgress: () => () => {},
    } as unknown as JobHandle<FetchUrlTaskOutput>);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

    const error = await task
      .run({ url: "https://example.com/f.bin", response_type: "stream" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/stream channel/i);
    expect(String(error)).toMatch(/response_type/);
    // Refused rather than settled: awaiting the job at all would have produced
    // the empty-bodied finish this exists to prevent.
    expect(waitFor).not.toHaveBeenCalled();
    expect(seen.some((e) => e.type === "finish")).toBe(false);
  });

  // A handle that DOES advertise `onStream` is only the possibility of
  // delivery. A durable queue's job may be claimed by a worker in another
  // process, which publishes its deltas nowhere this client can see — and no
  // advertise-time check can know that, because which process claims a job is
  // not decided until long after `send`. So the drain has to catch it: a
  // locally-claimed job always produces the terminal marker, so a stream that
  // settles successfully without one delivered nothing.
  test("fails loudly when a handle advertising onStream delivers nothing", async () => {
    const queueName = "queued-stream-undelivered";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

    const failure = task
      .run({ url: "https://example.com/f.bin", response_type: "stream" })
      .catch((e: unknown) => e);

    await stub.listening;
    // Settles SUCCESSFULLY, carrying the metadata-only payload a "stream" job
    // returns — and never invokes the listener. That is precisely the shape a
    // remotely-claimed job has here.
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/stream/i);
    expect(String(error)).toMatch(/empty body/i);
    expect(String(error)).toMatch(/never reached/i);
    expect(seen.some((e) => e.type === "finish")).toBe(false);
  });

  // ...and the same undelivering handle is perfectly fine for a materializing
  // response_type, whose bytes travel in the settled output rather than as
  // deltas. The check must be inert there, or it would break the channel-less
  // path that already works.
  test("a materializing response_type still passes the settled output through", async () => {
    const queueName = "queued-stream-undelivered-text";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const running = task
      .run({ url: "https://example.com/f.txt", response_type: "text" })
      .catch((e: unknown) => e);

    await stub.listening;
    stub.settle({ text: "hello", metadata: { status: 200 } } as FetchUrlTaskOutput);

    const out = await running;
    expect(out).not.toBeInstanceOf(Error);
    expect((out as FetchUrlTaskOutput).text).toBe("hello");
    expect((out as FetchUrlTaskOutput).metadata?.status).toBe(200);
  });

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

// ---------------------------------------------------------------------------
// A subclass that derives the real request from its input rather than fetching
// the input verbatim — the shape of every consumer whose task input is a
// domain key. `resolveFetchInput` is the only seam that runs on every dispatch
// path; the queued run below is the one that used to be served by an
// `execute()` override.
// ---------------------------------------------------------------------------
class RewrittenUrlFetchTask extends FetchUrlTask {
  public static override type = "RewrittenUrlFetchTask";
  protected override async resolveFetchInput(input: FetchUrlTaskInput): Promise<FetchUrlTaskInput> {
    const key = input.url!.split("/").pop();
    return {
      url: `https://example.com/resolved/${key}.bin`,
      method: "GET",
      response_type: "stream",
      headers: { "X-Resolved": "yes" },
    };
  }
}

/**
 * The SSRF shape the seam makes reachable: a public input (so `entitlements()`
 * declares no `network:private`) rewritten onto a loopback admin endpoint.
 */
class PrivateRewriteFetchTask extends FetchUrlTask {
  public static override type = "PrivateRewriteFetchTask";
  protected override async resolveFetchInput(): Promise<FetchUrlTaskInput> {
    return { url: "http://127.0.0.1:9/internal/admin", response_type: "stream" };
  }
}

/** Rewrites within the private origin the task input already declares. */
class SamePrivateOriginFetchTask extends FetchUrlTask {
  public static override type = "SamePrivateOriginFetchTask";
  protected override async resolveFetchInput(): Promise<FetchUrlTaskInput> {
    return { url: "http://127.0.0.1:9/internal/other", response_type: "stream" };
  }
}

/** Rewrites onto a DIFFERENT private origin than the one declared. */
class OtherPrivateOriginFetchTask extends FetchUrlTask {
  public static override type = "OtherPrivateOriginFetchTask";
  protected override async resolveFetchInput(): Promise<FetchUrlTaskInput> {
    return { url: "http://192.168.10.4/admin", response_type: "stream" };
  }
}

/**
 * A domain-key input — a key rather than a url, the shape
 * `resolveFetchInput` exists for. `entitlements()` finds no url on it, so the
 * strongest thing it can declare is an UNSCOPED `network:private`, which names
 * no destination and binds only under `enforceEntitlements`.
 */
const domainKeyInputSchema = {
  type: "object",
  properties: {
    key: { type: "string", title: "Key", description: "Domain key the request is built from" },
  },
  required: ["key"],
} as const satisfies DataPortSchema;

interface DomainKeyFetchInput extends FetchUrlTaskInput {
  readonly key: string;
}

class DomainKeyFetchTask extends FetchUrlTask<DomainKeyFetchInput> {
  public static override type = "DomainKeyFetchTask";
  public override inputSchema(): DataPortSchema {
    return domainKeyInputSchema;
  }
}

/** Resolves a domain key onto loopback, declaring nothing that covers it. */
class PrivateDomainKeyFetchTask extends DomainKeyFetchTask {
  public static override type = "PrivateDomainKeyFetchTask";
  protected override async resolveFetchInput(): Promise<FetchUrlTaskInput> {
    return { url: "http://127.0.0.1:9/internal/admin", response_type: "stream" };
  }
}

/** The same resolver, opted in as its own trust boundary. */
class TrustedPrivateDomainKeyFetchTask extends PrivateDomainKeyFetchTask {
  public static override type = "TrustedPrivateDomainKeyFetchTask";
  protected override allowsPrivateResolution(): boolean {
    return true;
  }
}

/** The ordinary domain-key case: a public destination, nothing to authorize. */
class PublicDomainKeyFetchTask extends DomainKeyFetchTask {
  public static override type = "PublicDomainKeyFetchTask";
  protected override async resolveFetchInput(input: FetchUrlTaskInput): Promise<FetchUrlTaskInput> {
    const { key } = input as DomainKeyFetchInput;
    return { url: `https://example.com/resolved/${key}.bin`, response_type: "stream" };
  }
}

class LegacyExecuteTask extends FetchUrlTask {
  public static override type = "LegacyExecuteTask";
  override async execute(
    input: FetchUrlTaskInput,
    context: IExecuteContext
  ): Promise<FetchUrlTaskOutput> {
    return super.execute(input, context);
  }
}

class LegacyExecuteGrandchildTask extends LegacyExecuteTask {
  public static override type = "LegacyExecuteGrandchildTask";
}

describe("FetchUrlTask subclass dispatch", () => {
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
    responder = singleChunkResponder;
    await setTaskQueueRegistry(null);
  });

  afterEach(async () => {
    await setTaskQueueRegistry(null);
  });

  test("honors a subclass's resolveFetchInput on a queued run", async () => {
    const queueName = "queued-stream-resolve-input";
    const { storage, server, client } = await registerQueue(
      queueName,
      new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName)
    );
    const sendSpy = vi.spyOn(client, "send");
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY));

    try {
      await server.start();

      const task = new RewrittenUrlFetchTask({ queue: queueName });
      const seen: StreamEvent[] = [];
      task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

      const out = (await task.run({
        url: "https://example.com/keys/abc",
        response_type: "stream",
      })) as FetchUrlTaskOutput;

      // Resolution has to happen before the payload is enqueued, not inside the
      // worker: the job input IS the persisted request.
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0]?.[0]).toMatchObject({
        url: "https://example.com/resolved/abc.bin",
        headers: { "X-Resolved": "yes" },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe("https://example.com/resolved/abc.bin");
      expect(out.metadata?.status).toBe(200);
      expect(totalDeltaBytes(seen)).toBe(concatBytes(CHUNKED_BODY).length);
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });

  // An override that no dispatch path calls is worse than a compile error: the
  // task fetches whatever unresolved input it was handed and writes the result
  // under the wrong key, silently.
  test("refuses a subclass that overrides execute()", () => {
    expect(() => new LegacyExecuteTask({})).toThrow(/execute\(\)/);
    expect(() => new LegacyExecuteTask({})).toThrow(/resolveFetchInput/);
    // Two levels down is the real shape of the consumers that do this, and a
    // check comparing only the immediate prototype would miss it.
    expect(() => new LegacyExecuteGrandchildTask({})).toThrow(/execute\(\)/);
    // The base class and a subclass that leaves execute() alone stay usable.
    expect(() => new FetchUrlTask({})).not.toThrow();
    expect(() => new RewrittenUrlFetchTask({})).not.toThrow();
  });

  // SECURITY: entitlements() is evaluated against the UNRESOLVED input, so a
  // rewrite is invisible to the declaration. The job classifies the RESOLVED
  // url and passes allowPrivate from that classification, which would let the
  // rewrite authorize the very access it hid.
  test("refuses a rewrite onto a private host the task never declared", async () => {
    const task = new PrivateRewriteFetchTask({});
    const error = await task
      .run({ url: "https://public.example.com/report", response_type: "stream" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/network:private|never declared/i);
    // The refusal has to precede the request; a fetch that was issued has
    // already reached the internal host.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("refuses a rewrite onto a different private origin than the declared one", async () => {
    const task = new OtherPrivateOriginFetchTask({});
    const error = await task
      .run({ url: "http://127.0.0.1:9/internal/admin", response_type: "stream" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/network:private|never declared/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The declaration is what authorizes, so a rewrite covered by it still runs:
  // the check must not turn every private-origin subclass into an error.
  test("allows a rewrite inside the declared private origin", async () => {
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY));
    const task = new SamePrivateOriginFetchTask({});
    const out = (await task.run({
      url: "http://127.0.0.1:9/internal/admin",
      response_type: "stream",
    })) as FetchUrlTaskOutput;

    expect(out.metadata?.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9/internal/other");
    expect(mockFetch.mock.calls[0]?.[1]?.allowPrivate).toBe(true);
  });

  // SECURITY: the declared-url branch above has a scope to measure against. A
  // domain-key input has none — `entitlements()` declares an unscoped
  // `network:private`, which binds only under `enforceEntitlements` (default
  // false). Left permissive, that resolver reaches loopback with
  // `allowPrivate: true` on the path every run actually takes.
  test("refuses a domain-key resolution onto a private host", async () => {
    const task = new PrivateDomainKeyFetchTask({});
    const error = await task.run({ key: "abc" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/network:private/);
    expect(String(error)).toMatch(/allowsPrivateResolution/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The refusal is a default, not a ban: a resolver that IS the trust boundary
  // says so, and then reaches the destination it chose.
  test("allows a domain-key private resolution when the subclass opts in", async () => {
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY));
    const task = new TrustedPrivateDomainKeyFetchTask({});
    const out = (await task.run({ key: "abc" })) as FetchUrlTaskOutput;

    expect(out.metadata?.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9/internal/admin");
    expect(mockFetch.mock.calls[0]?.[1]?.allowPrivate).toBe(true);
  });

  // Every domain-key subclass in the workspace resolves into public space, so
  // the refusal must not touch them: it keys on the resolved classification,
  // not on the absence of a declared url.
  test("leaves a domain-key resolution onto a public host alone", async () => {
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY));
    const task = new PublicDomainKeyFetchTask({});
    const out = (await task.run({ key: "abc" })) as FetchUrlTaskOutput;

    expect(out.metadata?.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://example.com/resolved/abc.bin");
    expect(mockFetch.mock.calls[0]?.[1]?.allowPrivate).toBe(false);
  });

  // A run whose stream produced nothing has to name the request that was
  // actually issued: a subclass whose input is a domain key carries no url at
  // all, which is the shape the seam exists for.
  test("names the resolved request when the stream produced no finish", async () => {
    const queueName = "queued-stream-resolved-failure-message";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new RewrittenUrlFetchTask({ queue: queueName });
    const failure = task
      .execute({ url: "https://example.com/keys/abc", response_type: "stream" }, executeContext())
      .catch((e: unknown) => e);

    const listener = await stub.listening;
    // The stream itself completed — the marker is what says so — and the job
    // then settled carrying nothing. Without the marker the run fails as an
    // undelivered stream instead, which is a different (and correct) complaint
    // that has no resolved request to name.
    void listener({ type: "finish", data: { metadata: { status: 200 } } });
    stub.settle(undefined as unknown as FetchUrlTaskOutput);

    const error = await failure;
    expect(String(error)).toContain("https://example.com/resolved/abc.bin");
  });
});

describe("queued fetch retry safety", () => {
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
    responder = singleChunkResponder;
    await setTaskQueueRegistry(null);
  });

  afterEach(async () => {
    await setTaskQueueRegistry(null);
  });

  // A retry re-issues from byte 0 while the consumer's subscription survives
  // the attempt, so a second attempt would append a whole body onto a partial
  // one and the run would report success over the concatenation.
  test("does not retry after body bytes have been delivered", async () => {
    const queueName = "queued-stream-truncated";
    const { storage, server, client } = await registerQueue(
      queueName,
      new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName)
    );
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY, { failAfterChunks: 3 }));

    try {
      await server.start();

      const task = new FetchUrlTask({ queue: queueName });
      const seen: StreamEvent[] = [];
      task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

      const error = await task
        .run({ url: "https://example.com/truncated.bin", response_type: "stream" })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      // One attempt, not ten: the request was issued exactly once.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [failed] = await client.peek(JobStatus.FAILED, 10);
      expect(failed?.errorCode).toBe("FETCH_BODY_TRUNCATED");
      expect(failed?.attempts).toBe(0);
      expect(await storage.size(JobStatus.COMPLETED)).toBe(0);
      // The partial body reached the consumer once, and only once — a second
      // attempt would have doubled this.
      expect(totalDeltaBytes(seen)).toBe(3 * CHUNKED_BODY[0]!.byteLength);
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });

  // The other half of the rule: a failure that lands before the first byte is
  // still retried, which is what a rate-limited caller depends on.
  test("still retries a failure that lands before the first byte", async () => {
    const queueName = "queued-stream-retry-before-body";
    const { storage, server } = await registerQueue(
      queueName,
      new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName)
    );
    let attempt = 0;
    responder = () => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(new Response("slow down", { status: 429 }));
      }
      return Promise.resolve(chunkedResponse(CHUNKED_BODY));
    };

    try {
      await server.start();

      const task = new FetchUrlTask({ queue: queueName });
      const seen: StreamEvent[] = [];
      task.on("stream_chunk", (e: StreamEvent) => seen.push(e));

      const out = (await task.run({
        url: "https://example.com/rate-limited.bin",
        response_type: "stream",
      })) as FetchUrlTaskOutput;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(out.metadata?.status).toBe(200);
      expect(await storage.size(JobStatus.COMPLETED)).toBe(1);
      // The 429 emitted nothing, so the surviving attempt's body stands alone.
      expect(Array.from(deltaBytes(seen))).toEqual(Array.from(concatBytes(CHUNKED_BODY)));
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });

  // The ban exists because a subscription outliving the attempt would
  // concatenate two bodies. With no `emitStreamEvent` the bytes went nowhere,
  // so there is nothing to concatenate — and banning retry here would spend a
  // large download's whole retry policy on the first mid-body reset.
  test("keeps a mid-body failure retryable when nothing can receive the bytes", async () => {
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY, { failAfterChunks: 3 }));

    const job = new FetchUrlJob<FetchUrlTaskInput, FetchUrlTaskOutput>({
      input: { url: "https://example.com/truncated.bin", response_type: "stream" },
    });
    const error = await job
      .execute(
        { url: "https://example.com/truncated.bin", response_type: "stream" },
        { signal: new AbortController().signal, updateProgress: async () => {} }
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as { code?: string }).code).not.toBe("FETCH_BODY_TRUNCATED");
  });

  // ...and the same job with a receiver attached still refuses to retry.
  test("bans retry once a receiver has been handed a delta", async () => {
    responder = () => Promise.resolve(chunkedResponse(CHUNKED_BODY, { failAfterChunks: 3 }));

    const job = new FetchUrlJob<FetchUrlTaskInput, FetchUrlTaskOutput>({
      input: { url: "https://example.com/truncated.bin", response_type: "stream" },
    });
    const error = await job
      .execute(
        { url: "https://example.com/truncated.bin", response_type: "stream" },
        {
          signal: new AbortController().signal,
          updateProgress: async () => {},
          emitStreamEvent: async () => {},
        }
      )
      .catch((e: unknown) => e);

    expect((error as { code?: string }).code).toBe("FETCH_BODY_TRUNCATED");
    expect(error).not.toBeInstanceOf(RetryableJobError);
  });
});

describe("queued fetch stream adapter", () => {
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
    responder = singleChunkResponder;
    await setTaskQueueRegistry(null);
  });

  afterEach(async () => {
    await setTaskQueueRegistry(null);
  });

  test("raises a stream error event instead of reporting success", async () => {
    const queueName = "queued-stream-error-event";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    const run = (async () => {
      for await (const event of task.executeStream(
        { url: "https://example.com/a.bin", response_type: "stream" },
        executeContext()
      )) {
        seen.push(event as StreamEvent);
      }
    })();
    const failure = run.catch((e: unknown) => e);

    const listener = await stub.listening;
    void listener({ type: "binary-delta", port: "body", binaryDelta: new Uint8Array([1, 2]) });
    void listener({ type: "error", error: new Error("worker exploded") });
    // The job's own completion signal says success — the in-band error is the
    // only report of the failure, so it has to be the one that wins.
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/worker exploded/);
    expect(seen.some((e) => e.type === "finish")).toBe(false);
    expect(seen.filter((e) => e.type === "binary-delta")).toHaveLength(1);
  });

  test("yields an event that lands after the job settled", async () => {
    const queueName = "queued-stream-late-event";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    let listener: JobStreamListener | undefined;
    const run = (async () => {
      for await (const event of task.executeStream(
        { url: "https://example.com/a.bin", response_type: "stream" },
        executeContext()
      )) {
        seen.push(event as StreamEvent);
        if (seen.length === 1) {
          // The job has already settled by the time this first delta is
          // delivered, so the loop is about to reach its termination check.
          // Scheduling the next event on a timer registered HERE puts it
          // strictly after that check and strictly before any turn the loop
          // itself takes — the exact window a settled-means-stop loop drops.
          setTimeout(() => {
            void listener?.({
              type: "binary-delta",
              port: "body",
              binaryDelta: new Uint8Array([9, 9]),
            });
            // Behind it, so the loop still has to notice the late delta on its
            // own: a marker delivered here can only END the loop, never
            // resurrect an event the loop already walked past.
            void listener?.({ type: "finish", data: { metadata: { status: 200 } } });
          }, 0);
        }
      }
    })();

    listener = await stub.listening;
    void listener({ type: "binary-delta", port: "body", binaryDelta: new Uint8Array([1, 2]) });
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    await run;
    expect(Array.from(deltaBytes(seen))).toEqual([1, 2, 9, 9]);
    expect(seen.at(-1)?.type).toBe("finish");
  });

  // One late event is not the shape a trailing body has: a carrier that runs
  // ahead of the consumer delivers a RUN of them. A single grace turn drains
  // the first and drops the rest, and then reports the truncation as a clean
  // finish — so the turn has to be earned again by each turn that drains
  // something.
  test("keeps draining while post-settlement events keep arriving", async () => {
    const queueName = "queued-stream-late-chain";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    const trailing = [10, 20, 30];
    let listener: JobStreamListener | undefined;
    const run = (async () => {
      for await (const event of task.executeStream(
        { url: "https://example.com/a.bin", response_type: "stream" },
        executeContext()
      )) {
        seen.push(event as StreamEvent);
        if (event.type !== "binary-delta") continue;
        const next = trailing.shift();
        if (next === undefined) {
          // The chain is spent, so close it the way a carrier does. Registered
          // on a timer like every link before it, hence still strictly after
          // the loop's termination check for the delta just yielded.
          setTimeout(() => {
            void listener?.({ type: "finish", data: { metadata: { status: 200 } } });
          }, 0);
          continue;
        }
        setTimeout(() => {
          void listener?.({
            type: "binary-delta",
            port: "body",
            binaryDelta: Uint8Array.from([next]),
          });
        }, 0);
      }
    })();

    listener = await stub.listening;
    void listener({ type: "binary-delta", port: "body", binaryDelta: Uint8Array.from([1]) });
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    await run;
    expect(Array.from(deltaBytes(seen))).toEqual([1, 10, 20, 30]);
    expect(seen.at(-1)?.type).toBe("finish");
  });

  // The stream's own terminal marker is what says the body is whole, and what
  // this pins is that the loop ends THERE rather than on settlement plus a
  // grace turn: the stray is scheduled on a timer, so a grace-turn ending
  // drains it and an ending on the marker never sees it.
  //
  // Not pinned: that nothing can follow the marker. A stray delivered
  // synchronously after it lands in `pending` before the loop resumes, and the
  // inner drain still yields it.
  test("ends on the stream's terminal marker rather than an idle turn", async () => {
    const queueName = "queued-stream-terminal-marker";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    let strayScheduled = false;
    let listener: JobStreamListener | undefined;
    const run = (async () => {
      for await (const event of task.executeStream(
        { url: "https://example.com/a.bin", response_type: "stream" },
        executeContext()
      )) {
        seen.push(event as StreamEvent);
        if (event.type !== "binary-delta" || strayScheduled) continue;
        strayScheduled = true;
        // Registered before any turn the loop could take, so a loop that ends
        // on settlement-plus-a-turn instead of on the marker picks this up.
        setTimeout(() => {
          void listener?.({
            type: "binary-delta",
            port: "body",
            binaryDelta: Uint8Array.from([99]),
          });
        }, 0);
      }
    })();

    listener = await stub.listening;
    void listener({ type: "binary-delta", port: "body", binaryDelta: Uint8Array.from([1]) });
    void listener({ type: "finish", data: { metadata: { status: 200 } } });
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    await run;
    expect(Array.from(deltaBytes(seen))).toEqual([1]);
    expect(seen.at(-1)?.type).toBe("finish");
  });

  // The loop ends on the stream, but the VALUE is the job's settled output —
  // so a marker that arrives before the job has settled must not produce a
  // finish carrying nothing.
  test("takes the finish payload from the settled job, not the marker", async () => {
    const queueName = "queued-stream-marker-before-settle";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    const run = (async () => {
      for await (const event of task.executeStream(
        { url: "https://example.com/a.bin", response_type: "stream" },
        executeContext()
      )) {
        seen.push(event as StreamEvent);
      }
    })();

    const listener = await stub.listening;
    void listener({ type: "binary-delta", port: "body", binaryDelta: Uint8Array.from([1]) });
    void listener({ type: "finish", data: { metadata: { status: 999 } } });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    await run;
    const finish = seen.at(-1) as { type: string; data?: FetchUrlTaskOutput };
    expect(finish.type).toBe("finish");
    expect(finish.data?.metadata?.status).toBe(200);
  });

  // `execute()` drains the stream for callers that want one value. A job that
  // settles on nothing has produced no output, and the `{}` a missing finish
  // would leave behind reads as a successful fetch with no metadata.
  test("execute() refuses to return an output the stream never produced", async () => {
    const queueName = "queued-stream-empty-finish";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const failure = task
      .execute({ url: "https://example.com/a.bin", response_type: "stream" }, executeContext())
      .catch((e: unknown) => e);

    const listener = await stub.listening;
    // A complete delivery — marker and all — whose job then settled on
    // nothing. The output is what is missing here, not the stream.
    void listener({ type: "finish", data: { metadata: { status: 200 } } });
    stub.settle(undefined as unknown as FetchUrlTaskOutput);

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/finish payload/);
  });

  // A rejection is not guaranteed to carry an `Error`: a carrier rebuilding one
  // from an empty persisted column, or a bare `Promise.reject()`, settles with a
  // falsy reason. Deciding "did it fail" from the reason's truthiness skips the
  // rethrow, yields a finish carrying `undefined`, and reports the run as having
  // ended without a payload — the real failure replaced by a wrong diagnosis.
  test("a job that rejects with a falsy reason fails the run rather than reporting no payload", async () => {
    const queueName = "queued-stream-falsy-rejection";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const failure = task
      .execute({ url: "https://example.com/a.bin", response_type: "stream" }, executeContext())
      .catch((e: unknown) => e);

    await stub.listening;
    stub.fail(undefined);

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/finish payload/);
    expect(String(error)).toMatch(/rejected without a reason/i);
  });

  // A carrier that never awaits its dispatch can hand the adapter a whole body
  // faster than the consumer reads it. Nothing may be dropped or reordered when
  // that overruns the ready queue and parks the producer.
  test("keeps a flood of unawaited events complete and in order", async () => {
    const queueName = "queued-stream-flood";
    const stub = makeStubHandle();
    registerStubQueue(queueName, stub.handle);

    const task = new FetchUrlTask({ queue: queueName });
    const seen: StreamEvent[] = [];
    const run = (async () => {
      for await (const event of task.executeStream(
        { url: "https://example.com/a.bin", response_type: "stream" },
        executeContext()
      )) {
        seen.push(event as StreamEvent);
        // A consumer slower than the producer, which is the only condition
        // under which the ready queue can fill at all.
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
      }
    })();

    const listener = await stub.listening;
    const flood = Array.from({ length: 30 }, (_, i) => Uint8Array.from([i]));
    for (const chunk of flood) {
      void listener({ type: "binary-delta", port: "body", binaryDelta: chunk });
    }
    // Delivered while the whole flood is still queued, so it also pins that the
    // marker ends the loop only after everything ahead of it has been drained.
    void listener({ type: "finish", data: { metadata: { status: 200 } } });
    stub.settle({ metadata: { status: 200 } } as FetchUrlTaskOutput);

    await run;
    expect(Array.from(deltaBytes(seen))).toEqual(flood.map((c) => c[0]));
  });

  // Where the dispatch IS awaited (the channel-less fast path), the listener
  // promise is a real gate: the worker cannot run away from the consumer. The
  // measurement is the source's own production count, since the job pulls the
  // socket only as fast as it can hand a chunk over.
  test("paces the producer on the channel-less fast path", async () => {
    const queueName = "queued-stream-pacing";
    const { storage, server } = await registerQueue(
      queueName,
      new SqliteQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(
        new Sqlite.Database(":memory:"),
        queueName
      )
    );
    let produced = 0;
    const body = Array.from({ length: 20 }, (_, i) => Uint8Array.from([i]));
    responder = () =>
      Promise.resolve(
        chunkedResponse(body, {
          onProduce: () => {
            produced += 1;
          },
        })
      );

    try {
      await server.start();
      const task = new FetchUrlTask({ queue: queueName });
      let consumed = 0;
      let maxReadAhead = 0;
      for await (const event of task.executeStream(
        { url: "https://example.com/paced.bin", response_type: "stream" },
        executeContext()
      )) {
        if (event.type !== "binary-delta") continue;
        consumed += 1;
        maxReadAhead = Math.max(maxReadAhead, produced - consumed);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
      }
      expect(consumed).toBe(body.length);
      // One chunk in flight plus the source stream's own one-chunk high-water
      // mark. Unpaced, this would reach the whole body.
      expect(maxReadAhead).toBeLessThanOrEqual(3);
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });
});
