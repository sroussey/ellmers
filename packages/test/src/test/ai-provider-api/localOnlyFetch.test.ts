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
 * assert the STRICT LOOPBACK-ONLY policy: the initial URL is validated before
 * any network call, and each standard 3xx `Location` is re-validated and must
 * be loopback before being followed. The local AI servers run on localhost
 * ONLY by design, so RFC 1918 and link-local (incl. the 169.254.169.254
 * cloud-metadata IP) are rejected — closing the redirect-based SSRF bypass
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

/** Build a response with an explicit status carrying a `Location` header. */
function statusWithLocation(status: number, location: string): Response {
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

  it("refuses a redirect to the cloud-metadata link-local IP after one fetch", async () => {
    // 169.254.169.254 is the cloud-metadata address. The broad "local"
    // allow-list treats 169.254.0.0/16 as in-scope link-local, which is
    // exactly the SSRF vector this wrapper closes — under the loopback-only
    // policy it must be rejected, not followed.
    stubFetch([redirect("http://169.254.169.254/latest/meta-data/")]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect to a non-local public host after one fetch", async () => {
    // 203.0.113.10 is RFC 5737 TEST-NET-3 documentation space — unambiguously
    // non-local, so the redirect must be rejected, not followed.
    stubFetch([redirect("http://203.0.113.10/latest/meta-data/")]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect to an RFC 1918 private host after one fetch", async () => {
    // 10.0.0.5 is RFC 1918 private space — "local" under the broad allow-list
    // but NOT loopback. Proves the policy is loopback-only, not merely
    // "non-public".
    stubFetch([redirect("http://10.0.0.5/internal")]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect to an external host", async () => {
    stubFetch([redirect("https://evil.example.com/steal")]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host/);
    expect(calls).toHaveLength(1);
  });

  it("follows a redirect to another loopback host and returns the final body", async () => {
    stubFetch([redirect("http://127.0.0.1:9000/v1/models"), ok("final-body")]);
    const res = await localOnlyFetch("http://localhost:8080/v1/models", undefined, "TestProvider");
    expect(await res.text()).toBe("final-body");
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://127.0.0.1:9000/v1/models");
  });

  it("follows a relative Location resolved against a loopback base", async () => {
    stubFetch([redirect("/v1/models"), ok("relative-body")]);
    const res = await localOnlyFetch("http://127.0.0.1:9000/props", undefined, "TestProvider");
    expect(await res.text()).toBe("relative-body");
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://127.0.0.1:9000/v1/models");
  });

  it("returns a non-redirect 200 unchanged with exactly one fetch", async () => {
    stubFetch([ok("plain-body")]);
    const res = await localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider");
    expect(await res.text()).toBe("plain-body");
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("manual");
  });

  it("does not follow a 300/304 carrying a Location header (non-standard redirect codes)", async () => {
    // 300 Multiple Choices and 304 Not Modified are 3xx but are NOT standard
    // redirect codes; even with a Location they are returned unchanged. The
    // Location target here is non-loopback to prove it is never followed.
    stubFetch([statusWithLocation(300, "http://169.254.169.254/")]);
    const res = await localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider");
    expect(res.status).toBe(300);
    expect(calls).toHaveLength(1);

    stubFetch([statusWithLocation(304, "http://203.0.113.10/")]);
    const res2 = await localOnlyFetch("http://127.0.0.1:9000/v1/models", undefined, "TestProvider");
    expect(res2.status).toBe(304);
    expect(calls).toHaveLength(1);
  });

  it("rejects a non-loopback initial URL before issuing any fetch", async () => {
    // Queue a response that must never be consumed — validation happens
    // before the first network call, so zero fetches are issued.
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://169.254.169.254/latest/meta-data/", undefined, "TestProvider")
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
    await expect(localOnlyFetch("file:///etc/passwd", undefined, "TestProvider")).rejects.toThrow(
      /non-HTTP\(S\)/
    );
    expect(calls).toHaveLength(0);
  });

  // Regression coverage for the WHATWG-canonicalisation SSRF bypass: the URL
  // parser silently rewrites non-standard IPv4 spellings to `127.0.0.1`, so
  // validating `new URL(input).hostname` would let these slip past the
  // loopback gate. The fix validates the RAW host extracted from the source
  // string instead. Each spelling is asserted to reject AND to issue zero
  // fetches — mirrors the existing "rejects a non-loopback initial URL
  // before issuing any fetch" shape.
  it("rejects a hex-octet IPv4 initial URL (0x7f.0.0.1) before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://0x7f.0.0.1/", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host|invalid initial URL/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a uint32 IPv4 initial URL (2130706433) before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://2130706433/", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host|invalid initial URL/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a leading-zero octal-looking IPv4 initial URL (010.0.0.1) before issuing any fetch", async () => {
    stubFetch([ok("should-not-be-reached")]);
    await expect(
      localOnlyFetch("http://010.0.0.1/", undefined, "TestProvider")
    ).rejects.toThrow(/non-loopback host|invalid initial URL/);
    expect(calls).toHaveLength(0);
  });

  it("accepts an initial IPv6 loopback literal in brackets (positive case)", async () => {
    // `[::1]` is the canonical IPv6 loopback. `extractRawHost` strips the
    // surrounding brackets, so `isLoopbackHostname` receives `::1`.
    stubFetch([ok("ipv6-ok")]);
    const res = await localOnlyFetch("http://[::1]:8080/", undefined, "TestProvider");
    expect(await res.text()).toBe("ipv6-ok");
    expect(calls).toHaveLength(1);
  });

  it("rejects an initial IPv6 with a zone identifier", async () => {
    // `[::1%25eth0]` — the URL-encoded form of `::1%eth0` — carries an
    // interface zone ID. `parseIpv6` rejects any host containing `%`,
    // so the literal extracted by `extractRawHost` fails validation.
    stubFetch([ok("should-not-be-reached")]);
    await expect(localOnlyFetch("http://[::1%25eth0]/", undefined, "TestProvider")).rejects.toThrow(
      /non-loopback host|invalid initial URL/
    );
    expect(calls).toHaveLength(0);
  });

  it("follows a redirect whose Location uses a hex IPv4 spelling — the canonical form is loopback", async () => {
    // The Location header carries `http://0x7f.0.0.1/`. When the redirect
    // path resolves it via `new URL(location, current)`, WHATWG canonical-
    // ises the host to `127.0.0.1`. The redirect target's canonical hostname
    // is therefore `127.0.0.1` — a true loopback literal — and the redirect
    // is accepted. The security goal (do not leave the loopback host) holds:
    // the final destination IS 127.0.0.1.
    //
    // This pins current behaviour. If a future change validates redirect
    // Location headers against their raw (pre-canonical) form, this test
    // will need to flip to `rejects.toThrow(/non-loopback host/)`.
    stubFetch([redirect("http://0x7f.0.0.1/"), ok("hex-redirect-body")]);
    const res = await localOnlyFetch("http://127.0.0.1:9000/start", undefined, "TestProvider");
    expect(await res.text()).toBe("hex-redirect-body");
    expect(calls).toHaveLength(2);
  });

  it("follows a redirect to a bracketed IPv6 loopback (positive case)", async () => {
    stubFetch([redirect("http://[::1]/"), ok("ipv6-redirect-body")]);
    const res = await localOnlyFetch("http://127.0.0.1:9000/start", undefined, "TestProvider");
    expect(await res.text()).toBe("ipv6-redirect-body");
    expect(calls).toHaveLength(2);
  });


  it("throws after more than 5 chained loopback redirects", async () => {
    // Queue 6 redirects: hops 0..5 (six fetches) all return a redirect, so the
    // loop exhausts MAX_REDIRECTS (5) and throws on the count guard. All
    // targets are loopback so the only failure mode is the redirect-count
    // guard. (A 7th response is never reached and is intentionally omitted.)
    stubFetch([
      redirect("http://127.0.0.1:9000/a"),
      redirect("http://127.0.0.1:9000/b"),
      redirect("http://127.0.0.1:9000/c"),
      redirect("http://127.0.0.1:9000/d"),
      redirect("http://127.0.0.1:9000/e"),
      redirect("http://127.0.0.1:9000/f"),
    ]);
    await expect(
      localOnlyFetch("http://127.0.0.1:9000/start", undefined, "TestProvider")
    ).rejects.toThrow(/too many redirects/);
    expect(calls).toHaveLength(6);
  });
});
