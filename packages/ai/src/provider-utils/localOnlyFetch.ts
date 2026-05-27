/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isLoopbackHostname } from "./localUrl";

/**
 * Validate a request target against the strict LOOPBACK-ONLY policy: it must
 * be a valid http(s) URL, carry no credentials, and resolve to a loopback
 * host (`localhost`, `127.0.0.0/8`, `::1`, or IPv4-mapped loopback). Throws a
 * generic, label-prefixed Error otherwise.
 */
function assertLoopbackTarget(url: URL, label: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: refusing initial URL to non-HTTP(S) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}: refusing initial URL with credentials.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isLoopbackHostname(host)) {
    throw new Error(`${label}: refusing initial URL to non-loopback host (${url.href}).`);
  }
}

/**
 * fetch() restricted to STRICTLY-LOOPBACK hosts. These AI server clients only
 * ever talk to a backend on the same host, so a broad "local" allow-list
 * (which includes RFC 1918 and the `169.254.169.254` cloud-metadata address)
 * is wider than needed and is itself an SSRF vector. This wrapper therefore:
 *   - validates the initial `input` URL defensively BEFORE any network call —
 *     a bad initial URL throws with zero fetches issued; and
 *   - issues the request with `redirect: "error"`, so ANY redirect from the
 *     local backend is REJECTED OUTRIGHT rather than followed. On-host AI
 *     backends never legitimately issue redirects, so following them only
 *     opens a redirect-based SSRF bypass (and the opaque-response trap of
 *     `redirect: "manual"`). Rejecting redirects outright closes the vector
 *     uniformly across Node/undici, Bun, and the browser.
 *
 * A redirect rejection is rethrown as a clear, label-prefixed error. Abort
 * and network errors (including the AbortSignal in `init`) pass through
 * unchanged. The final Response is returned untouched so streaming consumers
 * are unaffected.
 */
export async function localOnlyFetch(
  input: string,
  init?: RequestInit,
  label = "localOnlyFetch",
): Promise<Response> {
  // Defensively validate the initial URL BEFORE issuing any request. A bad
  // initial URL must throw before fetch is ever called (zero network calls).
  let initialUrl: URL;
  try {
    initialUrl = new URL(input);
  } catch {
    throw new Error(`${label}: invalid initial URL.`);
  }
  assertLoopbackTarget(initialUrl, label);

  try {
    return await fetch(initialUrl.href, { ...init, redirect: "error" });
  } catch (err) {
    // Re-raise abort/network errors unchanged so callers (and the
    // AbortSignal) keep their existing semantics. A redirect rejection from
    // `redirect: "error"` is surfaced as a clear, labeled error.
    if (isAbortError(err)) throw err;
    if (isRedirectError(err)) {
      throw new Error(`${label}: refusing redirect from local backend`, { cause: err });
    }
    throw err;
  }
}

/**
 * True if `err` is an AbortError (from an aborted AbortSignal). Such errors
 * must pass through `localOnlyFetch` unchanged.
 */
function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR")
  );
}

/**
 * Best-effort detection of the rejection produced by `redirect: "error"` when
 * the server responds with a redirect. The exact error class/message differs
 * across runtimes (Node/undici, Bun, browsers), so we match on the well-known
 * message fragment rather than a single concrete type.
 */
function isRedirectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: { message?: string } }).cause;
  const msg = `${err.message} ${cause?.message ?? ""}`.toLowerCase();
  return msg.includes("redirect");
}
