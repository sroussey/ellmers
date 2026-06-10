/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef } from "./CacheRef";
import { isCacheRef } from "./CacheRef";

/**
 * Resolves a single {@link CacheRef} to bytes (or `undefined` on cache miss).
 * Wired up by callers against their configured cache backing; this module is
 * unaware of any specific repository implementation.
 */
export type CacheRefResolver = (ref: CacheRef) => Promise<Blob | undefined>;

/**
 * Streaming counterpart of {@link CacheRefResolver}. Returns an async iterable
 * of chunks for consumers that want to pipe the bytes further (e.g. into an
 * HTTP response) without materializing the full payload. Returns `undefined`
 * if the backing has no streaming retrieval for this ref or the entry is
 * absent.
 */
export type CacheRefStreamResolver = (ref: CacheRef) => AsyncIterable<Uint8Array> | undefined;

/**
 * Object shape carrying the optional by-ref readers a cache backing exposes
 * (the read surface of `TaskOutputRepository`). Both members are optional so
 * any repository — streaming or not — satisfies the shape; helpers degrade
 * per capability.
 */
export interface RefStreamBacking {
  readonly getOutputByRef?: (ref: CacheRef) => Promise<Blob | undefined>;
  readonly getOutputStreamByRef?: (ref: CacheRef) => AsyncIterable<Uint8Array> | undefined;
}

/** Adapt a `Blob` to the `AsyncIterable<Uint8Array>` chunk shape. */
export async function* byteIterableFromBlob(blob: Blob): AsyncIterable<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream a {@link CacheRef}'s bytes out of a backing. Prefers the backing's
 * streaming reader; falls back to materializing via `getOutputByRef` and
 * re-chunking through `blob.stream()`. Resolves `undefined` when the entry is
 * absent (dangling ref) or the backing exposes no readers.
 */
export async function streamRefViaBacking(
  ref: CacheRef,
  backing: RefStreamBacking
): Promise<AsyncIterable<Uint8Array> | undefined> {
  if (typeof backing.getOutputStreamByRef === "function") {
    const stream = backing.getOutputStreamByRef(ref);
    if (stream !== undefined) return stream;
  }
  if (typeof backing.getOutputByRef === "function") {
    const blob = await backing.getOutputByRef(ref);
    if (blob !== undefined) return byteIterableFromBlob(blob);
  }
  return undefined;
}

/** Options accepted by {@link resolveOutput}. */
export type ResolveOutputOptions = {
  /**
   * Maximum number of concurrent resolver calls. Defaults to unbounded
   * (`Infinity`), suitable for backings that handle their own pacing.
   * Set a finite value when the backing is rate-limited.
   */
  readonly concurrency?: number;
  /**
   * Predicate deciding which refs are resolved. Refs that fail the filter are
   * left in place (the slot keeps the original {@link CacheRef}). When omitted,
   * every ref is resolved.
   */
  readonly filter?: (ref: CacheRef) => boolean;
};

/**
 * Recursively visit a task output and replace every {@link CacheRef} encountered
 * with the value produced by the resolver. Non-ref values are returned as-is.
 *
 * Identity is preserved when the input contains no refs (or none that match the
 * optional filter): the same object reference comes back, so callers can rely
 * on `===` / `WeakMap` keys not being silently invalidated by an auto-resolve.
 *
 * Plain objects and arrays are walked structurally; objects with a non-Object
 * prototype (class instances such as `Error`, `URL`) are also walked, and the
 * returned clone preserves their prototype. `Blob`, `ArrayBuffer`, typed
 * arrays, `Date`, `RegExp`, and `Promise` are treated as opaque leaves.
 * `Map`/`Set` are walked through so that refs nested inside them can resolve.
 *
 * On cache miss the resolver returns `undefined`; the corresponding slot in
 * the returned output is `undefined`. This is the documented best-effort
 * behavior — callers either tolerate missing bytes or check explicitly.
 */
export async function resolveOutput<T>(
  output: T,
  resolver: CacheRefResolver,
  options?: ResolveOutputOptions
): Promise<T> {
  if (!hasMatchingRef(output, options?.filter)) return output;
  const limit = createLimiter(options?.concurrency);
  return (await walk(output, resolver, limit, options?.filter)) as T;
}

/**
 * Cheap pre-scan: returns `true` if any {@link CacheRef} (matching the
 * optional filter) is reachable inside `value`. Lets `resolveOutput`
 * short-circuit and preserve identity when nothing needs resolving.
 */
function hasMatchingRef(value: unknown, filter: ((ref: CacheRef) => boolean) | undefined): boolean {
  if (isCacheRef(value)) return filter ? filter(value) : true;
  if (value === null || value === undefined) return false;
  if (isLeaf(value)) return false;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (hasMatchingRef(v, filter)) return true;
    }
    return false;
  }
  if (value instanceof Map) {
    for (const v of value.values()) {
      if (hasMatchingRef(v, filter)) return true;
    }
    return false;
  }
  if (value instanceof Set) {
    for (const v of value) {
      if (hasMatchingRef(v, filter)) return true;
    }
    return false;
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const k of Object.keys(source)) {
      if (hasMatchingRef(source[k], filter)) return true;
    }
    return false;
  }
  return false;
}

async function walk(
  value: unknown,
  resolver: CacheRefResolver,
  limit: Limiter,
  filter: ((ref: CacheRef) => boolean) | undefined
): Promise<unknown> {
  if (isCacheRef(value)) {
    if (filter && !filter(value)) return value;
    return limit.run(() => resolver(value));
  }
  if (value === null || value === undefined) return value;
  if (isLeaf(value)) return value;
  if (!hasMatchingRef(value, filter)) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => walk(v, resolver, limit, filter)));
  }
  if (value instanceof Map) {
    const out = new Map();
    const entries = Array.from(value.entries());
    const resolved = await Promise.all(
      entries.map(async ([k, v]) => [k, await walk(v, resolver, limit, filter)] as const)
    );
    for (const [k, v] of resolved) out.set(k, v);
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    const resolved = await Promise.all(
      Array.from(value).map((v) => walk(v, resolver, limit, filter))
    );
    for (const v of resolved) out.add(v);
    return out;
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    // Preserve prototype so class instances (Error, URL, custom classes)
    // survive the walk without losing methods/instanceof identity.
    const proto = Object.getPrototypeOf(source);
    const out: Record<string, unknown> =
      proto === null || proto === Object.prototype ? {} : Object.create(proto);
    // Iterate in source order so the returned object's enumeration order
    // matches the input even though resolutions race.
    const keys = Object.keys(source);
    const resolvedValues = await Promise.all(
      keys.map((k) => walk(source[k], resolver, limit, filter))
    );
    for (let i = 0; i < keys.length; i++) out[keys[i]!] = resolvedValues[i];
    return out;
  }
  return value;
}

function isLeaf(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (value instanceof Blob) return true;
  if (value instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(value)) return true;
  if (value instanceof Date) return true;
  if (value instanceof RegExp) return true;
  if (value instanceof Promise) return true;
  return false;
}

type Limiter = { run<T>(fn: () => Promise<T>): Promise<T> };

function createLimiter(concurrency: number | undefined): Limiter {
  if (concurrency === undefined || concurrency === Infinity) {
    return { run: (fn) => fn() };
  }
  let free = Math.max(1, Math.floor(concurrency));
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      while (free <= 0) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      free--;
      try {
        return await fn();
      } finally {
        free++;
        const next = waiters.shift();
        if (next) next();
      }
    },
  };
}
