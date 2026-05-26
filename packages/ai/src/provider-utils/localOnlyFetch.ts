/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isLocalHostname } from "./localUrl";

const MAX_REDIRECTS = 5;

/**
 * Returns true only when `res` is a spec-shaped 3xx redirect: a numeric
 * `status` in [300, 400) AND a `headers.get` method we can read `location`
 * from. Real `fetch` responses always satisfy both; minimal test doubles
 * (e.g. `{ ok: true, json }`) have `undefined` status/headers and are
 * therefore treated as terminal responses rather than misclassified as
 * redirects (which would throw on `res.headers.get`). This narrows the
 * redirect path without weakening validation of genuine redirects.
 */
function isRedirectResponse(res: Response): boolean {
  const status = res.status;
  if (typeof status !== "number" || status < 300 || status >= 400) return false;
  return typeof res.headers?.get === "function";
}

/**
 * fetch() restricted to strictly-local hosts on EVERY hop. Uses manual redirect
 * handling and re-validates each 3xx Location (resolved against the current URL)
 * through the same allow-list as normalizeLocalHttpUrl, closing the
 * redirect-based SSRF bypass left by base-URL-only validation.
 */
export async function localOnlyFetch(
  input: string,
  init?: RequestInit,
  label = "localOnlyFetch",
): Promise<Response> {
  let current = input;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (!isRedirectResponse(res)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    const next = new URL(location, current);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new Error(`${label}: refusing redirect to non-HTTP(S) URL.`);
    }
    if (next.username || next.password) {
      throw new Error(`${label}: refusing redirect with credentials.`);
    }
    const host = next.hostname.replace(/^\[|\]$/g, "");
    if (!isLocalHostname(host)) {
      throw new Error(`${label}: refusing redirect to non-local host (${next.href}).`);
    }
    current = next.href;
  }
  throw new Error(`${label}: too many redirects (> ${MAX_REDIRECTS}).`);
}
