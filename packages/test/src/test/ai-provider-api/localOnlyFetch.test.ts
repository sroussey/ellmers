/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for `@workglow/ai/provider-utils` `localOnlyFetch`.
 *
 * Lives under `packages/test/src/test/ai-provider-api/` so it is picked up
 * by the root `scripts/test.ts` harness (which only scans section
 * directories under `packages/test/src/test`). The helper itself lives in
 * `packages/ai/src/provider-utils/localOnlyFetch.ts`.
 *
 * These tests stub the global `fetch` and assert the STRICT LOOPBACK-ONLY
 * policy: the initial URL is validated before any network call, and the
 * request is issued with `redirect: "error"` so ANY redirect from the local
 * backend is rejected outright (never followed). On-host AI backends never
 * legitimately redirect, so this closes the redirect-based SSRF bypass that
 * base-URL-only validation left open — uniformly across Node/undici, Bun,
 * and the browser.
 */

import { localOnlyFetch } from "@workglow/ai/provider-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalFetch = globalThis.fetch;

/** A single recorded fetch call: the URL string and the init redirect mode. */
interface RecordedCall {
  url: string;
  redirect: RequestRedirect | undefined;
}

let calls: RecordedCall[];

/**
 * Install a stub `fetch` that returns the queued responses in order. Each
 * call records the requested URL and redirect mode so tests can assert the
 * exact call shape.
 */
function stubFetch(responses: Response[]): void {
  let i = 0;
  calls = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      redirect: init?.redirect,
    });
    const res = responses[i++];
    if (!res) {
      throw new Error(`stubFetch: no response queued for call #${i}`);
    }
    return Promise.resolve(res);
  }) as typeof fetch;
}

/**
 * Install a stub `fetch` that REJECTS with `err` — used to simulate the
 * rejection a real runtime throws under `redirect: "error"` when the server
 * responds with a 3xx redirect.
 */
function stubFetchReject(err: Error): void {
  calls = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      redirect: init?.redirect,
    });
    return Promise.reject(err);
  }) as typeof fetch;
}

/** Build a terminal 200 response carrying `body`. */
function ok(body: string): Response {
  return new Response(body, { status: 200 });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("localOnlyFetch", () => {
  beforeEach(() => {
    calls = [];
  });

  it("issues the request with redirect: \"error\" and returns a 200 unchanged", async () => {
    stubFetch([ok("plain-body")]);
    const res = await localOnlyFetch(
      "http://127.0.0.1:9000/v1/models",
      undefined,
      "TestProvider"
    );
    expect(await res.text()).toBe("plain-body");
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("error");
  });

  it("throws a labeled redirect error when fetch rejects (simulating redirect: \"error\")", async () => {
    // Under `redirect: "error"` a real runtime rejects the promise when the
    // server responds with a 3xx. The exact error differs across runtimes, so
    // we match on the well-known "redirect" message fragment.
    stubFetchReject(new TypeError("fetch failed: unexpected redirect"));
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/TestProvider: refusing redirect from local backend/);
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("error");
  });

  it("passes an AbortError through unchanged", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    stubFetchReject(abort);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toBe(abort);
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("error");
  });

  it("rejects a non-loopback initial URL before issuing any fetch", async () => {
    // 169.254.169.254 is the cloud-metadata address — "local" under the broad
    // allow-list but NOT loopback. Queue a response that must never be
    // consumed: validation happens before the first network call.
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://169.254.169.254/latest/meta-data/", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an RFC 1918 initial URL before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://10.0.0.5/internal", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an external initial URL before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("https://evil.example.com/steal", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an initial URL carrying credentials before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://user:pass@127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/credentials/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-HTTP(S) initial URL before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("file:///etc/passwd", undefined, "TestProvider")
    ).rejects.toThrow(/non-HTTP\(S\)/);
    expect(calls).toHaveLength(0);
  });
});
