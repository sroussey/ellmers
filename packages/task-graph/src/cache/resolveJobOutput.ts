/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef } from "./CacheRef";
import { isCacheRef } from "./CacheRef";
import type { CacheRefResolver, RefStreamBacking, ResolveOutputOptions } from "./resolveRef";
import { byteIterableFromBlob, resolveOutput, streamRefViaBacking } from "./resolveRef";

/**
 * Structural type matching `@workglow/job-queue`'s `JobHandle`. Declared
 * locally so this module doesn't have to import from job-queue (avoiding a
 * runtime dependency edge for a structural shape).
 */
export interface JobHandleLike<Output> {
  waitFor(): Promise<Output>;
}

/**
 * Carrier of the resolver. Two-shape input: either a {@link CacheRefResolver}
 * function directly, or anything with a `getOutputByRef` method (the shape
 * `TaskOutputRepository` exposes).
 */
export type RefBacking =
  | CacheRefResolver
  | { readonly getOutputByRef?: (ref: CacheRef) => Promise<Blob | undefined> };

/**
 * Await a job's completion and hydrate every {@link CacheRef} inside its
 * `Output` to inline bytes via the supplied backing. The backing can be a
 * raw resolver function or any object exposing `getOutputByRef` (e.g. a
 * `TaskOutputRepository`).
 *
 * On cache miss the placeholder is replaced by `undefined` (best-effort
 * resolution). Backings that don't implement `getOutputByRef`
 * leave every ref in place.
 */
export async function resolveJobOutput<Output>(
  handle: JobHandleLike<Output>,
  backing: RefBacking,
  options?: ResolveOutputOptions
): Promise<Output> {
  const output = await handle.waitFor();
  const resolver = asResolver(backing);
  if (resolver === undefined) return output;
  return resolveOutput(output, resolver, options);
}

function asResolver(backing: RefBacking): CacheRefResolver | undefined {
  if (typeof backing === "function") return backing;
  const get = backing.getOutputByRef;
  if (typeof get !== "function") return undefined;
  return (ref) => get.call(backing, ref);
}

function collectCacheRefs(
  value: unknown,
  out: CacheRef[],
  visited: WeakSet<object> = new WeakSet()
): void {
  if (isCacheRef(value)) {
    out.push(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
  // Error / URL keep their data on the prototype; mirror the leaf set in
  // `resolveRef.ts` so both walkers stop at the same boundary.
  if (value instanceof Error) return;
  if (typeof URL !== "undefined" && value instanceof URL) return;
  if (visited.has(value as object)) return;
  visited.add(value as object);
  if (Array.isArray(value)) {
    for (const v of value) collectCacheRefs(v, out, visited);
    return;
  }
  if (value instanceof Map) {
    for (const v of value.values()) collectCacheRefs(v, out, visited);
    return;
  }
  if (value instanceof Set) {
    for (const v of value) collectCacheRefs(v, out, visited);
    return;
  }
  const source = value as Record<string, unknown>;
  for (const k of Object.keys(source)) collectCacheRefs(source[k], out, visited);
}

async function outputValueToStream(
  output: unknown,
  backing: RefStreamBacking,
  port?: string
): Promise<AsyncIterable<Uint8Array> | undefined> {
  let candidate: unknown;
  if (port !== undefined) {
    candidate = (output as Record<string, unknown> | undefined)?.[port];
  } else {
    const refs: CacheRef[] = [];
    collectCacheRefs(output, refs);
    if (refs.length > 1) {
      throw new Error(
        `resolveJobOutputStream: output contains ${refs.length} cache refs; pass an explicit port.`
      );
    }
    candidate = refs[0];
  }
  if (candidate === undefined) return undefined;
  if (isCacheRef(candidate)) return streamRefViaBacking(candidate, backing);
  if (candidate instanceof Blob) return byteIterableFromBlob(candidate);
  if (candidate instanceof ArrayBuffer) {
    const bytes = new Uint8Array(candidate);
    return (async function* () {
      yield bytes;
    })();
  }
  if (candidate instanceof Uint8Array) {
    const bytes = candidate;
    return (async function* () {
      yield bytes;
    })();
  }
  return undefined;
}

/**
 * Await a job's completion and stream its binary result back out of the
 * output cache without materializing it. `port` selects the output port;
 * when omitted, the single branded {@link CacheRef} reachable in the output
 * is used (two or more refs without a port is an error; zero resolves
 * `undefined`). Inline `Blob` / `ArrayBuffer` / `Uint8Array` values at a
 * named port are adapted to a stream so callers don't branch on whether the
 * reference threshold kept the value inline.
 *
 * Portless discovery walks the ENTIRE output, including fields whose content
 * the job may have copied from untrusted input — a crafted branded ref shape
 * embedded there would be resolved against the backing. Pass an explicit
 * `port` whenever the producer of the output is not fully trusted.
 */
export async function resolveJobOutputStream<Output>(
  handle: JobHandleLike<Output>,
  backing: RefStreamBacking,
  port?: string
): Promise<AsyncIterable<Uint8Array> | undefined> {
  return outputValueToStream(await handle.waitFor(), backing, port);
}

/**
 * Factory closing over a cache backing, producing the resolver shape
 * `@workglow/job-queue` accepts as `JobQueueClientOptions.outputStreamResolver`
 * (job-queue cannot import this package — the dependency edge points the
 * other way — so the resolver is injected as a structural function).
 */
export function makeJobOutputStreamResolver(
  backing: RefStreamBacking
): (output: unknown, port?: string) => Promise<AsyncIterable<Uint8Array> | undefined> {
  return (output, port) => outputValueToStream(output, backing, port);
}
