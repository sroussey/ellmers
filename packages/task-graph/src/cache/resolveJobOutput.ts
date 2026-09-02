/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { getStreamingPorts } from "../task/StreamTypes";
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

async function outputValueToStream(
  output: unknown,
  backing: RefStreamBacking,
  port?: string,
  outputSchema?: DataPortSchema
): Promise<AsyncIterable<Uint8Array> | undefined> {
  let candidate: unknown;
  if (port !== undefined) {
    candidate = (output as Record<string, unknown> | undefined)?.[port];
  } else {
    // Portless discovery: only consider ports the output schema declares as
    // streamable. A whole-output deep walk would resolve a crafted branded ref
    // that a job copied from untrusted input against the backing; restricting
    // to declared streaming ports removes that class of side-channel.
    if (outputSchema === undefined) {
      throw new TypeError(
        "resolveJobOutputStream: portless discovery requires the task's output " +
          "schema to enumerate declared streamable ports. Pass an explicit port " +
          "or supply outputSchema."
      );
    }
    const streamingPorts = getStreamingPorts(outputSchema);
    const record = output as Record<string, unknown> | undefined;
    const candidates: CacheRef[] = [];
    if (record !== undefined) {
      for (const { port: p } of streamingPorts) {
        const v = record[p];
        if (isCacheRef(v)) candidates.push(v);
      }
    }
    if (candidates.length > 1) {
      throw new Error(
        `resolveJobOutputStream: output contains ${candidates.length} cache refs; pass an explicit port.`
      );
    }
    candidate = candidates[0];
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
  // Inline values of the non-binary streamable modes: a below-threshold
  // append port hydrates to a string, an object port to a plain object/array.
  // Adapt them to the same byte encoding the ref form streams (UTF-8 text;
  // one NDJSON line that folds back to the same value) so caller behavior
  // does not flip on payload size.
  if (typeof candidate === "string") {
    const bytes = new TextEncoder().encode(candidate);
    return (async function* () {
      yield bytes;
    })();
  }
  if (
    port !== undefined &&
    candidate !== null &&
    typeof candidate === "object" &&
    (Array.isArray(candidate) || Object.getPrototypeOf(candidate) === Object.prototype)
  ) {
    const bytes = new TextEncoder().encode(JSON.stringify(candidate) + "\n");
    return (async function* () {
      yield bytes;
    })();
  }
  return undefined;
}

/**
 * Await a job's completion and stream its binary result back out of the
 * output cache without materializing it. `port` selects the output port;
 * when omitted, the caller must supply `outputSchema` and portless discovery
 * enumerates only the ports the schema declares as streamable via `x-stream`
 * (two or more refs across those ports is an error; zero resolves `undefined`).
 * Inline values at a named port — `Blob` / `ArrayBuffer` / `Uint8Array`, plus
 * the `string` and plain object/array forms a below-threshold append/object
 * ref hydrates to — are adapted to a stream so callers don't branch on
 * whether the reference threshold kept the value inline.
 */
export async function resolveJobOutputStream<Output>(
  handle: JobHandleLike<Output>,
  backing: RefStreamBacking,
  port?: string,
  outputSchema?: DataPortSchema
): Promise<AsyncIterable<Uint8Array> | undefined> {
  return outputValueToStream(await handle.waitFor(), backing, port, outputSchema);
}

/**
 * Factory closing over a cache backing, producing the resolver shape
 * `@workglow/job-queue` accepts as `JobQueueClientOptions.outputStreamResolver`
 * (job-queue cannot import this package — the dependency edge points the
 * other way — so the resolver is injected as a structural function).
 */
export function makeJobOutputStreamResolver(
  backing: RefStreamBacking,
  outputSchema?: DataPortSchema
): (output: unknown, port?: string) => Promise<AsyncIterable<Uint8Array> | undefined> {
  return (output, port) => outputValueToStream(output, backing, port, outputSchema);
}
