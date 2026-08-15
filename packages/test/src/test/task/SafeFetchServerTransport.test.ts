/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-transport tests for the server SafeFetch implementation.
 *
 * Every other SafeFetch test installs a mock through `registerSafeFetch`, so
 * none of them exercise the undici request, the passthrough TransformStream, or
 * the dispatcher lifecycle — the code that actually runs in production. This
 * file talks to a throwaway `node:http` server over loopback and never mocks
 * the transport, which is why it can see a body-pipe rejection that a mocked
 * suite cannot: an unhandled rejection under Node's default
 * `--unhandled-rejections=throw` terminates the process.
 */

import { FetchUrlTask, getSafeFetchImpl, safeFetch } from "@workglow/tasks";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

interface TestServer {
  readonly origin: string;
  readonly server: http.Server;
}

const servers: http.Server[] = [];
const timers: NodeJS.Timeout[] = [];

/**
 * Start a loopback HTTP server on an ephemeral port. Registered for teardown in
 * `afterEach`.
 */
async function withServer(handler: http.RequestListener): Promise<TestServer> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, server };
}

async function closeServer(server: http.Server): Promise<void> {
  // undici keeps sockets alive; without closeAllConnections() the close()
  // callback never fires and the hook times out.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Timer that is cleared on teardown, so a stalling handler cannot leak one. */
function trackedTimeout(fn: () => void, ms: number): void {
  timers.push(setTimeout(fn, ms));
}

/**
 * An unhandled rejection is reported after the microtask queue drains, on a
 * later macrotask turn — two `setImmediate` turns is enough for Node to have
 * decided a rejection had no handler.
 */
async function drainRejections(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitForNoConnections(server: http.Server, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let count = await new Promise<number>((resolve) =>
    server.getConnections((_err, n) => resolve(n ?? 0))
  );
  while (count > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    count = await new Promise<number>((resolve) =>
      server.getConnections((_err, n) => resolve(n ?? 0))
    );
  }
  return count;
}

describe("SafeFetch server transport (real node:http, no mocks)", () => {
  let unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandledRejection);
  });

  afterEach(async () => {
    process.off("unhandledRejection", onUnhandledRejection);
    for (const timer of timers.splice(0)) clearTimeout(timer);
    for (const server of servers.splice(0)) await closeServer(server);
  });

  // Tripwire: the whole file is vacuous if a mock is installed, so assert the
  // registered implementation is the one from SafeFetch.server.ts. It is not
  // exported from the package root, so identify it by function name.
  test("the registered implementation is the real server transport", () => {
    expect(getSafeFetchImpl().name).toBe("serverSafeFetch");
  });

  test("cancelling an unread 200 body raises no unhandled rejection", async () => {
    const { origin } = await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });

    const response = await safeFetch(`${origin}/`, { allowPrivate: true });
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    await response.body!.cancel();
    await drainRejections();

    expect(unhandled).toEqual([]);
  });

  test("a cancelled body still frees the connection for the next request", async () => {
    const { origin, server } = await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });

    const first = await safeFetch(`${origin}/`, { allowPrivate: true });
    await first.body!.cancel();

    // The dispatcher must still be closed on the cancel path, otherwise its
    // keep-alive socket stays open forever.
    expect(await waitForNoConnections(server, 5000)).toBe(0);

    const second = await safeFetch(`${origin}/`, { allowPrivate: true });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("ok");

    await drainRejections();
    expect(unhandled).toEqual([]);
  });

  test("a fully read body returns the complete text and raises no unhandled rejection", async () => {
    const { origin } = await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("chunk-1;");
      trackedTimeout(() => {
        res.write("chunk-2;");
        trackedTimeout(() => res.end("chunk-3"), 10);
      }, 10);
    });

    const response = await safeFetch(`${origin}/`, { allowPrivate: true });
    expect(await response.text()).toBe("chunk-1;chunk-2;chunk-3");

    await drainRejections();
    expect(unhandled).toEqual([]);
  });

  test("abandoning a body midway raises no unhandled rejection", async () => {
    const { origin } = await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("first;");
      // Keep the response open so the cancel lands mid-body.
      trackedTimeout(() => res.write("second;"), 500);
    });

    const response = await safeFetch(`${origin}/`, { allowPrivate: true });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain("first;");

    await reader.cancel();
    await drainRejections();

    expect(unhandled).toEqual([]);
  });

  test("a connection reset mid-body surfaces on the read, not as an unhandled rejection", async () => {
    const { origin } = await withServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-length": "1024" });
      res.write("partial");
      trackedTimeout(() => req.socket.destroy(), 10);
    });

    const response = await safeFetch(`${origin}/`, { allowPrivate: true });
    await expect(response.text()).rejects.toThrow();

    await drainRejections();
    expect(unhandled).toEqual([]);
  });

  test("aborting FetchUrlTask mid-body raises no unhandled rejection", async () => {
    const { origin } = await withServer((_req, res) => {
      // A stated content-length makes FetchUrlTask report progress per chunk,
      // which is where the abort lands; the body is never completed.
      res.writeHead(200, { "content-type": "text/plain", "content-length": "4096" });
      res.write("first-chunk;");
      trackedTimeout(() => res.write("second-chunk;"), 1000);
    });

    const task = new FetchUrlTask();
    task.on("progress", () => task.abort());
    trackedTimeout(() => task.abort(), 1500);

    await expect(task.run({ url: `${origin}/`, response_type: "text" })).rejects.toThrow();

    await drainRejections();
    expect(unhandled).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Regression (C1): this is the one test in the repo that can see undici
  // actually decompress. Every other fetch suite installs a mock through
  // registerSafeFetch, so none of them exercise the `accept-encoding` undici
  // appends on the caller's behalf, nor the passthrough that hands the origin's
  // header list back verbatim alongside the DECODED bytes.
  //
  // `Content-Length` counts encoded bytes; FetchUrlTask's read loop counts
  // decoded ones. Comparing them made every compressed response fail with
  // CONTENT_LENGTH_MISMATCH — a PermanentJobError, so no retry — raised only
  // after the correct body had already reached the consumer and the cache
  // sink. Here 50_000 bytes compress to a few dozen, so the numbers are as far
  // apart as they can get and the assertion is on the whole payload rather
  // than on the absence of an error.
  // -------------------------------------------------------------------------
  test("a gzipped body is delivered whole, not measured against the encoded length", async () => {
    const payload = "x".repeat(50_000);
    const gzipped = zlib.gzipSync(payload);
    expect(gzipped.byteLength).toBeLessThan(payload.length);

    const { origin } = await withServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-encoding": "gzip",
        // The encoded length, which is what a real origin states.
        "content-length": String(gzipped.byteLength),
      });
      res.end(gzipped);
    });

    const result = await new FetchUrlTask().run({ url: `${origin}/`, response_type: "text" });
    expect(result.text).toBe(payload);

    await drainRejections();
    expect(unhandled).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Regression (H1): a non-2xx carries a body like any other response, and the
  // passthrough this transport returns parks until that body is read or
  // cancelled — `new TransformStream()` has a readable HWM of 0, so `pipeTo`
  // never settles on its own. The `.finally(closeAgent)` hanging off it
  // therefore never ran for a response the task threw on, leaking an undici
  // Agent and its socket per attempt (the queued path sends maxAttempts: 10).
  //
  // Connection count is the observable: a leaked Agent keeps its keep-alive
  // socket open, so `getConnections` never reaches 0. Both statuses are
  // covered because they fail differently — a 404 is permanent, a 500 is the
  // retryable one a long-lived worker hits over and over.
  //
  // `keepAliveTimeout` is raised off its 5s default deliberately. At the
  // default the SERVER reaps the idle socket at almost exactly the deadline
  // below, so the count reaches 0 whether or not the client ever released the
  // Agent — the test passes on the broken code and measures nothing. Holding
  // the server side open makes the client's release the only thing that can
  // drop the connection.
  // -------------------------------------------------------------------------
  for (const status of [404, 500] as const) {
    test(`a ${status} with a body still frees the connection`, async () => {
      const { origin, server } = await withServer((_req, res) => {
        res.writeHead(status, { "content-type": "text/plain" });
        res.end("error body");
      });
      server.keepAliveTimeout = 120_000;
      server.headersTimeout = 125_000;

      await expect(
        new FetchUrlTask().run({ url: `${origin}/`, response_type: "text" })
      ).rejects.toThrow();

      expect(await waitForNoConnections(server, 5000)).toBe(0);

      await drainRejections();
      expect(unhandled).toEqual([]);
    });
  }
});
