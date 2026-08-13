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
export type CacheRefStreamResolver = (
  ref: CacheRef
) => AsyncIterable<Uint8Array> | undefined | Promise<AsyncIterable<Uint8Array> | undefined>;

/**
 * Object shape carrying the optional by-ref readers a cache backing exposes
 * (the read surface of `TaskOutputRepository`). Both members are optional so
 * any repository — streaming or not — satisfies the shape; helpers degrade
 * per capability.
 */
export interface RefStreamBacking {
  readonly getOutputByRef?: (ref: CacheRef) => Promise<Blob | undefined>;
  readonly getOutputStreamByRef?: (
    ref: CacheRef
  ) => AsyncIterable<Uint8Array> | undefined | Promise<AsyncIterable<Uint8Array> | undefined>;
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
    // Await so an asynchronous backing (a DB store that cannot probe existence
    // synchronously) resolves a dangling ref to `undefined` — a cache miss —
    // rather than a truthy Promise the caller would mistake for a live stream.
    // Synchronous backings return the iterable directly; awaiting it is a no-op.
    const stream = await backing.getOutputStreamByRef(ref);
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
};

/**
 * Recursively visit a task output and replace every {@link CacheRef} encountered
 * with the value produced by the resolver. Non-ref values are returned as-is.
 *
 * Identity is preserved when the input contains no refs: the same object
 * reference comes back, so callers can rely on `===` / `WeakMap` keys not
 * being silently invalidated by an auto-resolve.
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
  if (isCacheRef(output)) {
    const limit = createLimiter(options?.concurrency);
    return (await walk(output, resolver, limit, new WeakSet(), undefined, new WeakSet())) as T;
  }
  const scan = scanContainers(output);
  if (!scan.hasRef) return output;
  const limit = createLimiter(options?.concurrency);
  // Acyclic values (the norm) memoize each container's resolution promise so a
  // subtree shared between two slots resolves ONCE and both slots receive the
  // same resolved copy — a plain visited-set would hand the second slot the
  // original, unresolved object. Cyclic values keep the conservative
  // visited-set behavior: cycles are returned by reference, unrewritten.
  const memo = scan.hasCycle ? undefined : new WeakMap<object, Promise<unknown>>();
  return (await walk(output, resolver, limit, new WeakSet(), memo, scan.refBearing)) as T;
}

/** What one traversal of the output tells the walker. */
interface ContainerScan {
  /** Containers from which a {@link CacheRef} is reachable. */
  readonly refBearing: WeakSet<object>;
  /** Whether any ref is reachable at all — lets `resolveOutput` preserve identity. */
  readonly hasRef: boolean;
  /** Whether a back-edge exists, which disables resolution memoization. */
  readonly hasCycle: boolean;
}

/** Children the walker would descend into, in walk order. */
function childrenOf(value: object): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (value instanceof Set) return Array.from(value);
  return Object.values(value as Record<string, unknown>);
}

/**
 * Single iterative pass over the walker's container vocabulary (plain objects,
 * Array, Map, Set; leaves are opaque) answering everything the walk needs to
 * know up front: which containers hold a reachable {@link CacheRef}, whether
 * any ref exists at all, and whether the graph has a back-edge.
 *
 * One pass, not three: a per-container `hasRef` probe inside the walk re-scanned
 * each node's whole subtree, making resolution O(n·depth). It is iterative for
 * the same reason — a deeply nested model output (thousands of levels) blew the
 * stack in the recursive probe, surfacing as a `RangeError` from cache
 * resolution rather than a cache miss.
 *
 * Cycles keep the pre-existing approximation: a container reached again while
 * still on the current path contributes nothing to its parent's answer. A ref
 * reachable ONLY through a back-edge can therefore go unnoticed, which is
 * consistent with the walker returning cycles by reference, unrewritten.
 */
function scanContainers(root: unknown): ContainerScan {
  const refBearing = new WeakSet<object>();
  if (root === null || typeof root !== "object" || isLeaf(root)) {
    return { refBearing, hasRef: false, hasCycle: false };
  }
  const done = new WeakSet<object>();
  const onPath = new WeakSet<object>();
  let hasCycle = false;

  type Frame = { readonly node: object; readonly children: readonly unknown[]; index: number };
  const stack: Frame[] = [{ node: root, children: childrenOf(root), index: 0 }];
  onPath.add(root);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.index >= frame.children.length) {
      stack.pop();
      onPath.delete(frame.node);
      done.add(frame.node);
      const parent = stack[stack.length - 1];
      if (parent !== undefined && refBearing.has(frame.node)) refBearing.add(parent.node);
      continue;
    }
    const child = frame.children[frame.index++];
    if (isCacheRef(child)) {
      refBearing.add(frame.node);
      continue;
    }
    if (child === null || typeof child !== "object" || isLeaf(child)) continue;
    const obj = child as object;
    if (onPath.has(obj)) {
      hasCycle = true;
      continue;
    }
    if (done.has(obj)) {
      // Shared subtree: its answer is already final, so reuse it.
      if (refBearing.has(obj)) refBearing.add(frame.node);
      continue;
    }
    onPath.add(obj);
    stack.push({ node: obj, children: childrenOf(obj), index: 0 });
  }

  return { refBearing, hasRef: refBearing.has(root), hasCycle };
}

async function walk(
  value: unknown,
  resolver: CacheRefResolver,
  limit: Limiter,
  visited: WeakSet<object>,
  memo: WeakMap<object, Promise<unknown>> | undefined,
  refBearing: WeakSet<object>
): Promise<unknown> {
  if (isCacheRef(value)) {
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
  // Answered by the single up-front scan; probing the subtree here made
  // resolution O(n·depth) and recursed once per level.
  if (!refBearing.has(obj)) return value;
  if (memo) {
    const promise = walkContainer(value, resolver, limit, visited, memo, refBearing);
    memo.set(obj, promise);
    return promise;
  }
  visited.add(obj);
  return walkContainer(value, resolver, limit, visited, memo, refBearing);
}

async function walkContainer(
  value: unknown,
  resolver: CacheRefResolver,
  limit: Limiter,
  visited: WeakSet<object>,
  memo: WeakMap<object, Promise<unknown>> | undefined,
  refBearing: WeakSet<object>
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => walk(v, resolver, limit, visited, memo, refBearing)));
  }
  if (value instanceof Map) {
    const out = new Map();
    const entries = Array.from(value.entries());
    const resolved = await Promise.all(
      entries.map(
        async ([k, v]) => [k, await walk(v, resolver, limit, visited, memo, refBearing)] as const
      )
    );
    for (const [k, v] of resolved) out.set(k, v);
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    const resolved = await Promise.all(
      Array.from(value).map((v) => walk(v, resolver, limit, visited, memo, refBearing))
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
      keys.map((k) => walk(source[k], resolver, limit, visited, memo, refBearing))
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
