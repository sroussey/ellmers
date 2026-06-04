/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef } from "./CacheRef";
import type { CacheRefResolver, ResolveOutputOptions } from "./resolveRef";
import { resolveOutput } from "./resolveRef";

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
