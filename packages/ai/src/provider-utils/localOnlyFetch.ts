/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { extractRawHost, isLoopbackHostname } from "./localUrl";

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
 *
 * `rawHost` is the LITERAL host extracted from the raw URL string via
 * {@link extractRawHost} BEFORE the WHATWG URL parser canonicalises it.
 * Validating the raw literal — not `url.hostname` — closes the bypass where
 * non-standard IPv4 spellings (`0x7f.0.0.1`, `2130706433`, `010.0.0.1`)
 * are silently rewritten by `new URL(...)` to a canonical loopback dotted-
 * quad and would otherwise slip past `isLoopbackHostname`. `extractRawHost`
 * already strips IPv6 surrounding brackets, so no further bracket stripping
 * is needed here. The fallback to `url.hostname` is defensive only and
 * should never be hit under the current call sites.
 */
function assertLoopbackTarget(
  url: URL,
  label: string,
  context: "initial URL" | "redirect",
  rawHost?: string | null
): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: refusing ${context} to non-HTTP(S) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}: refusing ${context} with credentials.`);
  }
  const host =
    rawHost !== undefined && rawHost !== null ? rawHost : url.hostname.replace(/^\[|\]$/g, "");
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
  label = "localOnlyFetch"
): Promise<Response> {
  // Defensively validate the initial URL BEFORE issuing any request. A bad
  // initial URL must throw before fetch is ever called (zero network calls).
  let initialUrl: URL;
  try {
    initialUrl = new URL(input);
  } catch {
    throw new Error(`${label}: invalid initial URL.`);
  }
  // Extract the LITERAL host from the raw input — not `initialUrl.hostname` —
  // so non-standard IPv4 spellings (`0x7f.0.0.1`, `2130706433`, `010.0.0.1`)
  // that WHATWG canonicalises to a loopback dotted-quad are rejected by the
  // strict-literal grammar in `isLoopbackHostname`. `extractRawHost` returns
  // `null` for URLs that do not match the basic `scheme://host` grammar, such
  // as `file:///path` (no host); those are NOT loopback HTTP targets, and
  // assertLoopbackTarget will reject them on the protocol gate. Pass the raw
  // host through so http(s) URLs use the strict-literal grammar; let null
  // fall through (assertLoopbackTarget's protocol check fires first for
  // non-http(s) URLs).
  const initialRawHost = extractRawHost(input);
  assertLoopbackTarget(initialUrl, label, "initial URL", initialRawHost);

  let current = initialUrl.href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (!isRedirectResponse(res)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    const next = new URL(location, current);
    // We extract the raw host from `next.href`, which is the WHATWG-canonical
    // serialisation of the redirect target. That means a Location header of
    // `http://0x7f.0.0.1/` is observed here as `http://127.0.0.1/` — the hex
    // spelling never reaches isLoopbackHostname, and the redirect is accepted
    // because the destination is, after canonicalisation, a true loopback
    // address. This is intentional: redirects are followed through WHATWG's
    // canonical view of the URL, and the security goal (do not leave the
    // loopback host) is upheld. The initial-URL gate above is the layer that
    // rejects the raw non-standard spelling so a caller cannot smuggle a
    // host that LOOKS like loopback but resolves elsewhere on rebinding.
    const nextRawHost = extractRawHost(next.href);
    if (nextRawHost === null) {
      throw new Error(`${label}: refusing redirect to invalid URL.`);
    }
    assertLoopbackTarget(next, label, "redirect", nextRawHost);
    current = next.href;
  }
  throw new Error(`${label}: too many redirects (> ${MAX_REDIRECTS}).`);
}
