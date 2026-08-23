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

import { PermanentJobError } from "@workglow/job-queue";
import { FetchUrlErrorCode, FetchUrlTask, getSafeFetchImpl, safeFetch } from "@workglow/tasks";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

interface TestServer {
  readonly origin: string;
  readonly server: http.Server;
}

/** Headers of every request a test server received, in arrival order. */
type RequestLog = Array<Readonly<Record<string, string | string[] | undefined>>>;

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

/** Method and collected body of every request a test server received. */
interface RecordedCall {
  readonly method: string;
  readonly body: string;
}

/**
 * Records every inbound request and answers 200 with "landed". `seen` carries
 * the headers; `calls` carries the method and the collected body, which is what
 * a redirect must never replay to a target the caller did not choose.
 */
async function recordingServer(): Promise<{
  target: TestServer;
  seen: RequestLog;
  calls: RecordedCall[];
}> {
  const seen: RequestLog = [];
  const calls: RecordedCall[] = [];
  const target = await withServer((req, res) => {
    seen.push({ ...req.headers });
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({ method: req.method ?? "", body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("landed");
    });
  });
  return { target, seen, calls };
}

/** Answers every request with a redirect to `location`. */
async function redirectingServer(location: string, status = 302): Promise<TestServer> {
  return withServer((req, res) => {
    // Drain the request body before answering, so node does not destroy the
    // socket on an unconsumed POST and turn a redirect test into a reset.
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { location });
      res.end();
    });
  });
}

/**
 * A redirect whose body can never complete: it states a Content-Length far
 * larger than the bytes it sends and never ends. That makes the leak assertions
 * deterministic — a merely large body is sometimes swallowed whole by socket
 * buffers, which frees the connection for reasons that have nothing to do with
 * dispatcher lifetime. Here only cancelling the body can free it.
 *
 * `location` may be omitted to produce a 302 with no Location header.
 */
async function stallingRedirectServer(location: string | undefined): Promise<TestServer> {
  return withServer((req, res) => {
    req.resume();
    // The client destroys the socket when it cancels; the write that loses is
    // not a test failure.
    res.on("error", () => {});
    const headers: Record<string, string> = {
      "content-type": "text/plain",
      "content-length": "50000000",
    };
    if (location !== undefined) headers.location = location;
    res.writeHead(302, headers);
    res.write("x".repeat(65_536));
  });
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
    // bun-types 1.4 shadows `Process.off` with a memoryPressure-only overload;
    // the EventEmitter view still carries the generic one.
    (process as NodeJS.EventEmitter).off("unhandledRejection", onUnhandledRejection);
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

  // Nothing sets `Accept-Encoding`, so undici sends `gzip, deflate` on its own,
  // transparently decodes, and leaves the origin's `Content-Length` — which
  // counts the COMPRESSED octets — on the response. Only a real transport shows
  // this: every mocked fixture builds an uncompressed `new Response(...)`, where
  // the stated length and the delivered bytes are the same number by
  // construction.
  test("a content-encoded body is not measured against the compressed Content-Length", async () => {
    const payload = "compressible payload ".repeat(300);
    const gz = gzipSync(Buffer.from(payload, "utf8"));
    // The whole point is that the two counts differ; equal ones would make the
    // assertion below pass on a build that still compares them.
    expect(gz.byteLength).toBeLessThan(payload.length / 10);

    const { origin } = await withServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-encoding": "gzip",
        "content-length": String(gz.byteLength),
      });
      res.end(gz);
    });

    const task = new FetchUrlTask();
    const reported: number[] = [];
    task.on("progress", (progress: number | undefined) => {
      if (typeof progress === "number") reported.push(progress);
    });

    const out = await task.run({ url: `${origin}/`, response_type: "text" });

    expect(out.text).toBe(payload);
    // The compressed length as a denominator would have put this at ~1200%.
    for (const progress of reported) expect(progress).toBeLessThanOrEqual(100);

    await drainRejections();
    expect(unhandled).toEqual([]);
  });

  // Throwing on the status alone leaves the body unread, and undici holds the
  // connection until GC gets to it — one socket per attempt, on a path whose
  // 429/5xx are retried up to `maxAttempts`.
  test("a non-2xx response frees its connection instead of leaking it", async () => {
    const body = "x".repeat(200_000);
    const { origin, server } = await withServer((_req, res) => {
      res.writeHead(503, {
        "content-type": "text/plain",
        "content-length": String(body.length),
      });
      res.end(body);
    });

    const task = new FetchUrlTask();
    await expect(task.run({ url: `${origin}/`, response_type: "text" })).rejects.toThrow(/503/);

    expect(await waitForNoConnections(server, 5000)).toBe(0);

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

  // ---------------------------------------------------------------------------
  // Cross-origin redirect credential strip.
  //
  // Two loopback servers on different ephemeral ports give a genuine
  // cross-origin redirect over the real undici transport, so the second server
  // reports exactly what bytes reached it. `privateResourceScopes` is left
  // undefined throughout (the legacy direct-caller mode), because a scope would
  // reject the cross-origin hop before the header strip is ever reached — these
  // tests must fail when the strip is removed, not pass because of a different
  // guard.
  // ---------------------------------------------------------------------------
  describe("cross-origin redirect header strip", () => {
    test("a cross-origin 302 drops Authorization before the second hop", async () => {
      // The finding itself: a vendor that answers 302 to an attacker origin
      // would otherwise receive the bearer token verbatim.
      const { target, seen } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`);

      const response = await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        headers: { Authorization: "Bearer super-secret-token", Accept: "text/plain" },
      });

      expect(await response.text()).toBe("landed");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.authorization).toBeUndefined();
      // Targeted, not a blanket wipe: an ordinary header still crosses.
      expect(seen[0]!.accept).toBe("text/plain");
    });

    test("a same-origin 302 keeps Authorization", async () => {
      // Guards the opposite failure: a strip that fires on every redirect would
      // silently break authenticated APIs that redirect within their own origin.
      const seen: RequestLog = [];
      const { origin } = await withServer((req, res) => {
        seen.push({ ...req.headers });
        if (req.url === "/start") {
          res.writeHead(302, { location: "/landed" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("landed");
      });

      const response = await safeFetch(`${origin}/start`, {
        allowPrivate: true,
        headers: { Authorization: "Bearer super-secret-token" },
      });

      expect(await response.text()).toBe("landed");
      expect(seen).toHaveLength(2);
      expect(seen[1]!.authorization).toBe("Bearer super-secret-token");
    });

    test("a caller-named credential header passed via sensitiveHeaders is dropped", async () => {
      // `credential_scheme: "header"` puts the secret on an arbitrary header,
      // which safeFetch cannot recognize; without the option it would replay.
      const { target, seen } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`);

      await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        headers: { "X-Api-Key": "sk-secret", "X-Trace-Id": "trace-1" },
        sensitiveHeaders: ["x-api-key"],
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]!["x-api-key"]).toBeUndefined();
      expect(seen[0]!["x-trace-id"]).toBe("trace-1");
    });

    test("sensitiveHeaders matching is case-insensitive against the sent header", async () => {
      // HTTP header names are case-insensitive; a case-sensitive compare would
      // leak whenever the configured name and the sent name differ in case.
      const { target, seen } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`);

      await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        headers: { "x-api-key": "sk-secret" },
        sensitiveHeaders: ["X-Api-Key"],
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]!["x-api-key"]).toBeUndefined();
    });

    test("a differing port on the same host counts as cross-origin and strips", async () => {
      // A hostname comparison would call these same-origin and replay the token.
      // Both servers are 127.0.0.1; only the ephemeral ports differ.
      const { target, seen } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`);
      expect(new URL(hop.origin).hostname).toBe(new URL(target.origin).hostname);

      await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        headers: { Authorization: "Bearer super-secret-token" },
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]!.authorization).toBeUndefined();
    });

    test("cookie and proxy-authorization are dropped without any sensitiveHeaders", async () => {
      // The fixed strip-set must not depend on the caller opting in.
      const { target, seen } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`);

      await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        headers: {
          Cookie: "session=abc123",
          "Proxy-Authorization": "Basic cHJveHk6cHc=",
          "X-Trace-Id": "trace-1",
        },
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]!.cookie).toBeUndefined();
      expect(seen[0]!["proxy-authorization"]).toBeUndefined();
      expect(seen[0]!["x-trace-id"]).toBe("trace-1");
    });

    test("a header stripped on one hop stays stripped when the chain returns home", async () => {
      // Laundering guard: A -> B -> A must not restore the token on the final
      // hop just because the last URL happens to share the first URL's origin.
      const seen: RequestLog = [];
      // Assigned once the away server has a port; the handler only reads it at
      // request time, which is after both servers are listening.
      let awayLocation = "";
      const home = await withServer((req, res) => {
        seen.push({ ...req.headers, "x-path": req.url ?? "" });
        if (req.url === "/start") {
          res.writeHead(302, { location: awayLocation });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("home-again");
      });
      const away = await withServer((_req, res) => {
        res.writeHead(302, { location: `${home.origin}/final` });
        res.end();
      });
      awayLocation = `${away.origin}/away`;

      const response = await safeFetch(`${home.origin}/start`, {
        allowPrivate: true,
        headers: { Authorization: "Bearer super-secret-token" },
      });

      expect(await response.text()).toBe("home-again");
      const finalHop = seen.find((headers) => headers["x-path"] === "/final");
      expect(finalHop).toBeDefined();
      expect(finalHop!.authorization).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Redirect method / body handling, over the real transport.
  //
  // The server loop is an independent implementation of the browser one, so the
  // decisive cases are mirrored here: only a real server can report the method
  // and the bytes that actually arrived, and only a real transport shows whether
  // a stated Content-Length still matches the request it rode in on.
  // ---------------------------------------------------------------------------
  describe("cross-origin redirect method and body", () => {
    const SECRET_BODY = JSON.stringify({ client_secret: "sk-body-secret-1234567890" });

    test("a cross-origin 303 arrives as a bodiless GET with no Content-Length", async () => {
      const { target, seen, calls } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`, 303);

      const response = await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        method: "POST",
        body: SECRET_BODY,
        headers: { "content-type": "application/json" },
      });

      expect(await response.text()).toBe("landed");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe("GET");
      expect(calls[0]!.body).toBe("");
      expect(seen[0]!["content-length"]).toBeUndefined();
      expect(seen[0]!["content-type"]).toBeUndefined();
    });

    test("a cross-origin 302 on a POST arrives as a bodiless GET", async () => {
      const { target, seen, calls } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`, 302);

      const response = await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        method: "POST",
        body: SECRET_BODY,
        headers: { "content-type": "application/json" },
      });

      expect(await response.text()).toBe("landed");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe("GET");
      expect(calls[0]!.body).toBe("");
      expect(seen[0]!["content-length"]).toBeUndefined();
    });

    test("a cross-origin 307 carrying a body is refused and never reaches the target", async () => {
      const { target, calls } = await recordingServer();
      const hop = await redirectingServer(`${target.origin}/landed`, 307);

      const error = await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        method: "POST",
        body: SECRET_BODY,
        headers: { "content-type": "application/json" },
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PermanentJobError);
      expect((error as { code?: string }).code).toBe(FetchUrlErrorCode.REDIRECT_BODY_NOT_REPLAYED);
      expect(calls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Dispatcher lifetime on the redirect paths.
  //
  // Each hop gets its own undici Agent, and an Agent that is never closed keeps
  // its keep-alive socket open — so the server's own connection count is a real,
  // unmocked assertion about dispatcher lifetime. The waits are generous on
  // purpose: a fix that merely DELAYS the close must still fail.
  // ---------------------------------------------------------------------------
  describe("dispatcher lifetime across redirects", () => {
    const CONNECTION_WAIT_MS = 2000;

    test("a redirect to a denied target frees the previous hop's connection", async () => {
      // The leak is on exactly the denial path the SSRF work exists to
      // exercise: hop 2 throws before anything closes hop 1's Agent.
      const denied = await withServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("should-never-be-reached");
      });
      const hop = await redirectingServer(`${denied.origin}/admin`);

      const error = await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        privateResourceScopes: [`${hop.origin}/*`],
      }).catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe(FetchUrlErrorCode.SCOPE_DENIED);
      expect(await waitForNoConnections(hop.server, CONNECTION_WAIT_MS)).toBe(0);

      await drainRejections();
      expect(unhandled).toEqual([]);
    });

    test("exhausting the redirect budget frees every connection", async () => {
      // The terminal throw sits outside the loop, so the final hop's Agent was
      // never closed at all.
      const loop = await withServer((_req, res) => {
        res.writeHead(302, { location: "/again" });
        res.end();
      });

      const error = await safeFetch(`${loop.origin}/start`, { allowPrivate: true }).catch(
        (e: unknown) => e
      );

      expect((error as { code?: string }).code).toBe(FetchUrlErrorCode.TOO_MANY_REDIRECTS);
      expect(await waitForNoConnections(loop.server, CONNECTION_WAIT_MS)).toBe(0);

      await drainRejections();
      expect(unhandled).toEqual([]);
    });

    test("a followed redirect with a non-empty body drains it and frees the connection", async () => {
      // Agent.close() waits for pending requests, and an un-cancelled redirect
      // body IS one — so without the drain the close never completes.
      const { target } = await recordingServer();
      const hop = await stallingRedirectServer(`${target.origin}/landed`);

      const response = await safeFetch(`${hop.origin}/start`, { allowPrivate: true });
      expect(await response.text()).toBe("landed");

      expect(await waitForNoConnections(hop.server, CONNECTION_WAIT_MS)).toBe(0);

      await drainRejections();
      expect(unhandled).toEqual([]);
    });

    test("a 302 with no Location frees the connection", async () => {
      const hop = await stallingRedirectServer(undefined);

      const error = await safeFetch(`${hop.origin}/start`, { allowPrivate: true }).catch(
        (e: unknown) => e
      );

      expect((error as { code?: string }).code).toBe(FetchUrlErrorCode.REDIRECT_MISSING_LOCATION);
      expect(await waitForNoConnections(hop.server, CONNECTION_WAIT_MS)).toBe(0);

      await drainRejections();
      expect(unhandled).toEqual([]);
    });

    test("redirect:'manual' still hands the caller a readable body", async () => {
      // The caller owns that body, so nothing may cancel it on their behalf.
      const hop = await withServer((_req, res) => {
        res.writeHead(302, { location: "/elsewhere", "content-type": "text/plain" });
        res.end("manual-body");
      });

      const response = await safeFetch(`${hop.origin}/start`, {
        allowPrivate: true,
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(await response.text()).toBe("manual-body");

      await drainRejections();
      expect(unhandled).toEqual([]);
    });
  });
});
