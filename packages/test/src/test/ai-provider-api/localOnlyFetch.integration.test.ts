/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for `localOnlyFetch` against a REAL loopback HTTP server.
 *
 * Unlike the unit tests (which stub `fetch`), these spin up an
 * `http.createServer` bound to `127.0.0.1:0` so we exercise the actual
 * `redirect: "error"` behaviour of the host runtime's `fetch`:
 *   - a 200 endpoint returns its body; and
 *   - a 302 endpoint causes `localOnlyFetch` to REJECT (the redirect is never
 *     followed).
 *
 * Also asserts the config-time gate: `normalizeLoopbackHttpUrl` throws on an
 * RFC 1918 base URL.
 */

import { localOnlyFetch, normalizeLoopbackHttpUrl } from "@workglow/ai/provider-utils";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("integration-ok");
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/ok" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

describe("localOnlyFetch (integration, real loopback server)", () => {
  it("returns the body from a 200 loopback endpoint", async () => {
    const res = await localOnlyFetch(`${base}/ok`, undefined, "TestProvider");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("integration-ok");
  });

  it("rejects rather than following a 302 from the loopback backend", async () => {
    await expect(
      localOnlyFetch(`${base}/redirect`, undefined, "TestProvider")
    ).rejects.toThrow();
  });
});

describe("normalizeLoopbackHttpUrl (config-time gate)", () => {
  it("throws on an RFC 1918 base URL", () => {
    expect(() => normalizeLoopbackHttpUrl("http://10.0.0.5:9000", "X")).toThrow();
  });

  it("accepts a loopback base URL", () => {
    expect(normalizeLoopbackHttpUrl("http://127.0.0.1:9000/v1", "X")).toBe(
      "http://127.0.0.1:9000/v1"
    );
  });
});
