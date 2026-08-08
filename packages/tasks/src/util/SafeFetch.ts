/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SSRF-aware fetch wrapper.
 *
 * The browser default performs a static URL classification only and delegates
 * to `globalThis.fetch`. The Node/Bun entrypoints register a server-side
 * implementation (see `SafeFetch.server.ts`) that additionally resolves DNS,
 * classifies every resolved address, and pins the connection to a specific
 * IP via an undici Agent — this closes the DNS-rebinding gap.
 *
 * Callers pass `allowPrivate` to opt into private/loopback targets. The task
 * layer sets this flag based on whether the task has been granted the
 * `network:private` entitlement (via its dynamic `entitlements()`).
 */

import { SECURITY_LIMITS } from "@workglow/util";
import type { FetchUrlJobErrorInstance } from "../task/FetchUrlJobError";
import {
  createFetchUrlJobError,
  FetchUrlErrorCode,
  isFetchUrlJobError,
} from "../task/FetchUrlJobError";
import { classifyUrl, urlMatchesScope } from "./UrlClassifier";

export interface SafeFetchOptions extends RequestInit {
  /**
   * When true, requests to private/loopback/link-local/metadata hosts are
   * permitted. When false (default), such requests throw PermanentJobError
   * both at URL-classification time and (in the server impl) at DNS-resolution
   * time — defeating DNS rebinding.
   */
  readonly allowPrivate?: boolean;
  /**
   * When `allowPrivate` is true, additionally restrict private-host requests
   * (including redirect targets) to URLs matching at least one of these glob
   * patterns. Must match the patterns the task declared in its
   * `network:private` entitlement scope (see `urlResourcePattern`). When
   * `undefined`, no scope check is applied and the boolean `allowPrivate`
   * governs alone — legacy behavior for direct callers outside the task
   * layer.
   *
   * This closes the "compromised redirect escapes grant scope" SSRF gap:
   * the task-graph enforcer approves a narrow private-host scope at
   * preflight, and this field re-enforces that same scope on every redirect
   * hop so a Location header cannot pivot to a different private host or
   * port the task was never authorized to reach.
   */
  readonly privateResourceScopes?: readonly string[];
}

export type SafeFetchFn = (url: string, options: SafeFetchOptions) => Promise<Response>;

const MAX_REDIRECT_HOPS = SECURITY_LIMITS.safeFetchMaxRedirectHops;

function assertAllowedUrl(
  url: string,
  allowPrivate: boolean | undefined,
  privateResourceScopes: readonly string[] | undefined
): void {
  const classification = classifyUrl(url);
  if (classification.kind === "invalid") {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.INVALID_URL,
      `Refusing to fetch invalid URL: ${classification.reason}`,
      { url }
    );
  }
  if (classification.kind !== "private") return;
  if (!allowPrivate) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.PRIVATE_DENIED,
      `Refusing to fetch private/internal URL ${url}: ${classification.reason}. ` +
        `Grant the 'network:private' entitlement to allow this request.`,
      { url }
    );
  }
  if (privateResourceScopes !== undefined && !urlMatchesScope(url, privateResourceScopes)) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.SCOPE_DENIED,
      `Refusing to fetch private/internal URL ${url}: outside granted network:private scope ` +
        `[${privateResourceScopes.join(", ")}]. A compromised upstream may be attempting ` +
        `to escape the task's authorized private-host origin.`,
      { url }
    );
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Builds the refusal both transports raise when a 3xx arrives and the caller
 * asked for `redirect: "error"`. Every transport MUST route that refusal
 * through this factory: it is the only construction site, so the single
 * {@link FetchUrlErrorCode.REDIRECT_NOT_FOLLOWED} discriminant is what
 * {@link isSafeFetchRedirectError} matches on, and no consumer has to
 * recognize the refusal from the wording of a message.
 *
 * The `Location` header is deliberately neither read nor reported. A caller
 * whose URL is itself a credential (see `postWebhookJson`) turns this into a
 * user-facing message, and the target an untrusted endpoint tried to redirect
 * to has no place in a log line.
 */
export function createSafeFetchRedirectError(
  url: string,
  status: number
): FetchUrlJobErrorInstance {
  return createFetchUrlJobError(
    FetchUrlErrorCode.REDIRECT_NOT_FOLLOWED,
    `Refusing to follow redirect from ${url}: responded ${status} and redirect mode is 'error'.`,
    { url, httpStatus: status }
  );
}

/**
 * Narrow guard for the refusal {@link createSafeFetchRedirectError} builds.
 *
 * Exported so consumers never re-derive it from an error's name or message:
 * prose drifts silently, and a consumer that stops recognizing this refusal
 * falls through to its generic network branch — which is retryable, quietly
 * turning a refused redirect into a retried one.
 */
export function isSafeFetchRedirectError(error: unknown): error is FetchUrlJobErrorInstance {
  return isFetchUrlJobError(error) && error.code === FetchUrlErrorCode.REDIRECT_NOT_FOLLOWED;
}

/**
 * Browser-safe default implementation. Classifies the URL statically and
 * delegates to `globalThis.fetch`. Each redirect hop is validated before
 * following so a public URL cannot redirect to a private host.
 *
 * The browser controls DNS itself, so we cannot defeat DNS rebinding from
 * browser code — callers must rely on the browser sandbox (CORS,
 * same-origin) as the second layer.
 */
async function defaultSafeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  const requestedRedirectMode = options.redirect ?? "follow";
  const { allowPrivate, privateResourceScopes, redirect: _redirect, ...fetchOptions } = options;

  let currentUrl = url;
  for (let hops = 0; hops <= MAX_REDIRECT_HOPS; hops += 1) {
    assertAllowedUrl(currentUrl, allowPrivate, privateResourceScopes);

    const response = await globalThis.fetch(currentUrl, {
      ...fetchOptions,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    if (requestedRedirectMode === "manual") {
      return response;
    }

    if (requestedRedirectMode === "error") {
      throw createSafeFetchRedirectError(currentUrl, response.status);
    }

    const location = response.headers.get("location");
    if (!location) {
      throw createFetchUrlJobError(
        FetchUrlErrorCode.REDIRECT_MISSING_LOCATION,
        `Refusing to follow redirect from ${currentUrl}: missing Location header.`,
        { url: currentUrl }
      );
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw createFetchUrlJobError(
    FetchUrlErrorCode.TOO_MANY_REDIRECTS,
    `Refusing to fetch ${url}: too many redirects.`,
    { url }
  );
}

let currentImpl: SafeFetchFn = defaultSafeFetch;

/**
 * Register a platform-specific SafeFetch implementation. The Node/Bun
 * entrypoints call this at module load time to install the DNS-resolving,
 * connection-pinning implementation from `SafeFetch.server.ts`.
 *
 * Returns the previously registered implementation so callers can safely
 * restore it after a temporary override.
 */
export function registerSafeFetch(fn: SafeFetchFn): SafeFetchFn {
  const previousImpl = currentImpl;
  currentImpl = fn;
  return previousImpl;
}

export function getSafeFetchImpl(): SafeFetchFn {
  return currentImpl;
}

/** Restores the default browser-safe implementation. */
export function resetSafeFetch(): void {
  currentImpl = defaultSafeFetch;
}

/**
 * SSRF-aware fetch. See {@link SafeFetchOptions} for the `allowPrivate` flag.
 * Throws `PermanentJobError` if the URL targets a private host without
 * permission, or (server impl) if DNS resolves to a private IP.
 */
export function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  return currentImpl(url, options);
}
