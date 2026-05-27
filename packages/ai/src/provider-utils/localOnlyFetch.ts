/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isLoopbackHostname } from "./localUrl";

const MAX_REDIRECTS = 5;

/**
 * Standard HTTP redirect status codes per the Fetch/HTTP specs. A 3xx that is
 * NOT one of these (e.g. `300 Multiple Choices`, `304 Not Modified`,
 * `306 (unused)`) is NOT a redirect even if it carries a `Location` header —
 * such responses are returned to the caller unchanged.
 */
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Returns true only when `res` is a spec-shaped standard redirect: a numeric
 * `status` in {301,302,303,307,308} AND a `headers.get` method we can read
 * `location` from. Real `fetch` responses satisfy both; minimal test doubles
 * (e.g. `{ ok: true, json }`) have `undefined` status/headers and are
 * therefore treated as terminal responses rather than misclassified as
 * redirects (which would throw on `res.headers.get`). This narrows the
 * redirect path without weakening validation of genuine redirects.
 */
function isRedirectResponse(res: Response): boolean {
  const status = res.status;
  if (typeof status !== "number" || !REDIRECT_STATUS_CODES.has(status)) return false;
  return typeof res.headers?.get === "function";
}

/**
 * Validate a request target against the strict LOOPBACK-ONLY policy: it must
 * be a valid http(s) URL, carry no credentials, and resolve to a loopback
 * host (`localhost`, `127.0.0.0/8`, `::1`, or IPv4-mapped loopback). Throws a
 * generic, label-prefixed Error otherwise. `context` distinguishes the
 * initial URL from a redirect in the message.
 */
function assertLoopbackTarget(url: URL, label: string, context: "initial URL" | "redirect"): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: refusing ${context} to non-HTTP(S) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}: refusing ${context} with credentials.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isLoopbackHostname(host)) {
    throw new Error(`${label}: refusing ${context} to non-loopback host (${url.href}).`);
  }
}

/**
 * fetch() restricted to STRICTLY-LOOPBACK hosts on EVERY hop. These AI server
 * clients only ever talk to a backend on the same host, so a broad "local"
 * allow-list (which includes RFC 1918 and the `169.254.169.254` cloud-metadata
 * address) is wider than needed and is itself an SSRF vector. This wrapper
 * therefore enforces loopback-only on:
 *   - the initial `input` URL, validated defensively BEFORE any network call
 *     (a bad initial URL throws with zero fetches issued); and
 *   - every redirect `Location`, resolved against the current URL and
 *     re-validated, closing the redirect-based SSRF bypass left by
 *     base-URL-only validation.
 *
 * Only standard redirect codes (301/302/303/307/308) are followed; other 3xx
 * responses are returned unchanged. The final Response is returned untouched
 * so streaming consumers are unaffected.
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
  assertLoopbackTarget(initialUrl, label, "initial URL");

  let current = initialUrl.href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (!isRedirectResponse(res)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    const next = new URL(location, current);
    assertLoopbackTarget(next, label, "redirect");
    current = next.href;
  }
  throw new Error(`${label}: too many redirects (> ${MAX_REDIRECTS}).`);
}
