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
 * Walker policy is opaque-by-default: only plain objects (prototype
 * `Object.prototype` or `null`), `Array`, `Map`, and `Set` are walked
 * structurally. Every class instance — `Blob`, `ArrayBuffer`, typed arrays,
 * `Date`, `RegExp`, `Promise`, `Error`, `URL`, `Headers`, `Request`,
 * `Response`, `FormData`, `URLSearchParams`, `ReadableStream`, and any
 * user-defined class — is treated as an opaque leaf and returned by reference.
 * Walking such instances through `Object.keys()` would silently drop data that
 * lives on the prototype (accessors) or in private slots, so the safe default
 * is to leave them untouched.
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
  if (!hasMatchingRef(output, options?.filter, new WeakSet())) return output;
  const limit = createLimiter(options?.concurrency);
  // Acyclic values (the norm) memoize each container's resolution promise so a
  // subtree shared between two slots resolves ONCE and both slots receive the
  // same resolved copy — a plain visited-set would hand the second slot the
  // original, unresolved object. Cyclic values keep the conservative
  // visited-set behavior: cycles are returned by reference, unrewritten.
  const memo = containsCycle(output) ? undefined : new WeakMap<object, Promise<unknown>>();
  return (await walk(output, resolver, limit, options?.filter, new WeakSet(), memo)) as T;
}

/**
 * Depth-first cycle probe over the same container vocabulary as the walker
 * (plain objects, Array, Map, Set; leaves are opaque). Gray/black coloring:
 * an object seen again while still on the current path is a back-edge.
 */
function containsCycle(
  value: unknown,
  gray: WeakSet<object> = new WeakSet(),
  black: WeakSet<object> = new WeakSet()
): boolean {
  if (value === null || typeof value !== "object" || isLeaf(value)) return false;
  const obj = value as object;
  if (black.has(obj)) return false;
  if (gray.has(obj)) return true;
  gray.add(obj);
  const children: Iterable<unknown> = Array.isArray(value)
    ? value
    : value instanceof Map
      ? value.values()
      : value instanceof Set
        ? value
        : Object.values(value);
  for (const child of children) {
    if (containsCycle(child, gray, black)) return true;
  }
  gray.delete(obj);
  black.add(obj);
  return false;
}

/**
 * Cheap pre-scan: returns `true` if any {@link CacheRef} (matching the
 * optional filter) is reachable inside `value`. Lets `resolveOutput`
 * short-circuit and preserve identity when nothing needs resolving.
 *
 * `visited` short-circuits cyclic and shared-subtree structures: revisiting an
 * already-seen object answers `false` instead of recursing forever. The
 * pre-scan is a containment check, so reporting `false` on a revisit is safe —
 * if a ref were reachable through that subtree, the FIRST visit would have
 * found it.
 */
function hasMatchingRef(
  value: unknown,
  filter: ((ref: CacheRef) => boolean) | undefined,
  visited: WeakSet<object>
): boolean {
  if (isCacheRef(value)) return filter ? filter(value) : true;
  if (value === null || value === undefined) return false;
  if (isLeaf(value)) return false;
  if (typeof value === "object") {
    if (visited.has(value as object)) return false;
    visited.add(value as object);
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      if (hasMatchingRef(v, filter, visited)) return true;
    }
    return false;
  }
  if (value instanceof Map) {
    for (const v of value.values()) {
      if (hasMatchingRef(v, filter, visited)) return true;
    }
    return false;
  }
  if (value instanceof Set) {
    for (const v of value) {
      if (hasMatchingRef(v, filter, visited)) return true;
    }
    return false;
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const k of Object.keys(source)) {
      if (hasMatchingRef(source[k], filter, visited)) return true;
    }
    return false;
  }
  return false;
}

async function walk(
  value: unknown,
  resolver: CacheRefResolver,
  limit: Limiter,
  filter: ((ref: CacheRef) => boolean) | undefined,
  visited: WeakSet<object>,
  memo: WeakMap<object, Promise<unknown>> | undefined
): Promise<unknown> {
  if (isCacheRef(value)) {
    if (filter && !filter(value)) return value;
    return limit.run(() => resolver(value));
  }
  if (value === null || value === undefined) return value;
  if (isLeaf(value)) return value;
  const obj = value as object;
  if (memo) {
    // Acyclic path: a shared subtree resolves once; every referencing slot
    // awaits the same promise and receives the same resolved copy.
    const pending = memo.get(obj);
    if (pending !== undefined) return pending;
  } else if (visited.has(obj)) {
    // Cyclic fallback: a revisited object is returned by reference unchanged.
    // Cycles are not rewritten — the caller keeps their original graph
    // topology, including any unresolved refs the cycle contains.
    return value;
  }
  if (!hasMatchingRef(value, filter, new WeakSet())) return value;
  if (memo) {
    const promise = walkContainer(value, resolver, limit, filter, visited, memo);
    memo.set(obj, promise);
    return promise;
  }
  visited.add(obj);
  return walkContainer(value, resolver, limit, filter, visited, memo);
}

async function walkContainer(
  value: unknown,
  resolver: CacheRefResolver,
  limit: Limiter,
  filter: ((ref: CacheRef) => boolean) | undefined,
  visited: WeakSet<object>,
  memo: WeakMap<object, Promise<unknown>> | undefined
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => walk(v, resolver, limit, filter, visited, memo)));
  }
  if (value instanceof Map) {
    const out = new Map();
    const entries = Array.from(value.entries());
    const resolved = await Promise.all(
      entries.map(
        async ([k, v]) => [k, await walk(v, resolver, limit, filter, visited, memo)] as const
      )
    );
    for (const [k, v] of resolved) out.set(k, v);
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    const resolved = await Promise.all(
      Array.from(value).map((v) => walk(v, resolver, limit, filter, visited, memo))
    );
    for (const v of resolved) out.add(v);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    // Only plain objects (Object.prototype / null prototype) reach this
    // branch; class instances are screened out by isLeaf above and returned
    // by reference unchanged.
    const out: Record<string, unknown> = {};
    // Iterate in source order so the returned object's enumeration order
    // matches the input even though resolutions race.
    const keys = Object.keys(source);
    const resolvedValues = await Promise.all(
      keys.map((k) => walk(source[k], resolver, limit, filter, visited, memo))
    );
    for (let i = 0; i < keys.length; i++) out[keys[i]!] = resolvedValues[i];
    return out;
  }
  return value;
}

/**
 * Opaque-by-default policy. Only plain objects (prototype `Object.prototype`
 * or `null`), `Array`, `Map`, and `Set` are structurally walked. Every other
 * object — including `Blob`, `ArrayBuffer`, typed arrays, `Date`, `RegExp`,
 * `Promise`, `Error`, `URL`, `Headers`, `Request`, `Response`, `FormData`,
 * `URLSearchParams`, `ReadableStream`, and user-defined classes — is opaque:
 * generic `Object.keys()` cloning would drop prototype-resident data
 * (accessors) and private slots.
 */
function isLeaf(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (Array.isArray(value)) return false;
  if (value instanceof Map || value instanceof Set) return false;
  const proto = Object.getPrototypeOf(value);
  return proto !== null && proto !== Object.prototype;
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
