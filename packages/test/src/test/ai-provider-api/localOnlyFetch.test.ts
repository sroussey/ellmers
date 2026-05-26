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
 * These tests stub the global `fetch` with a queue of `Response` objects and
 * assert that each 3xx `Location` is re-validated against the local-only
 * allow-list before being followed — closing the redirect-based SSRF bypass
 * that base-URL-only validation left open.
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
 * call records the requested URL so tests can assert the exact hop count.
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

/** Build a 3xx redirect response pointing at `location`. */
function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
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

  it("refuses a redirect to a non-local public host after one fetch", async () => {
    // 203.0.113.10 is RFC 5737 TEST-NET-3 documentation space — unambiguously
    // non-local (unlike 169.254.0.0/16, which the allow-list treats as
    // in-scope link-local), so the redirect must be rejected, not followed.
    stubFetch([redirect("http://203.0.113.10/latest/meta-data/")]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/non-local host/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect to an external host", async () => {
    stubFetch([redirect("https://evil.example.com/steal")]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/non-local host/);
    expect(calls).toHaveLength(1);
  });

  it("follows a redirect to another local host and returns the final body", async () => {
    stubFetch([redirect("http://127.0.0.1:9000/v1/models"), ok("final-body")]);
    const res = await localOnlyFetch(
      "http://localhost:8080/v1/models",
      undefined,
      "TestProvider"
    );
    expect(await res.text()).toBe("final-body");
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://127.0.0.1:9000/v1/models");
  });

  it("follows a relative Location resolved against a local base", async () => {
    stubFetch([redirect("/v1/models"), ok("relative-body")]);
    const res = await localOnlyFetch(
      "http://127.0.0.1:9000/props",
      undefined,
      "TestProvider"
    );
    expect(await res.text()).toBe("relative-body");
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://127.0.0.1:9000/v1/models");
  });

  it("returns a non-redirect 200 unchanged with exactly one fetch", async () => {
    stubFetch([ok("plain-body")]);
    const res = await localOnlyFetch(
      "http://127.0.0.1:9000/v1/models",
      undefined,
      "TestProvider"
    );
    expect(await res.text()).toBe("plain-body");
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("manual");
  });

  it("throws after more than 5 chained local redirects", async () => {
    // 6 redirects in a row — exceeds MAX_REDIRECTS (5). All targets are local
    // so the only failure mode is the redirect-count guard.
    stubFetch([
      redirect("http://127.0.0.1:9000/a"),
      redirect("http://127.0.0.1:9000/b"),
      redirect("http://127.0.0.1:9000/c"),
      redirect("http://127.0.0.1:9000/d"),
      redirect("http://127.0.0.1:9000/e"),
      redirect("http://127.0.0.1:9000/f"),
      redirect("http://127.0.0.1:9000/g"),
    ]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/start", undefined, "TestProvider")
    ).rejects.toThrow(/too many redirects/);
  });
});
