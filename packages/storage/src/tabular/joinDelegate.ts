/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage, ITabularStorage } from "./ITabularStorage";

/** A storage that would rather a join addressed something behind it. */
interface JoinDelegating {
  joinDelegate(): AnyTabularStorage;
}

function isJoinDelegating(value: unknown): value is JoinDelegating {
  return typeof (value as JoinDelegating | null)?.joinDelegate === "function";
}

/**
 * Follows a chain of delegating wrappers to the storage a join should actually
 * address — the durable store behind a cache, the traced storage behind a
 * telemetry wrapper, and any nesting of those.
 *
 * Wrappers used to recognise only their own type, one level deep, which cost
 * more than a lost pushdown: a cached storage left wrapped had its half of the
 * join served by `query()` (the cache) while the other half read durable, so an
 * inner join silently dropped rows the two sides disagreed about.
 *
 * A wrapper that must stay in the path — one that scopes or filters what the
 * join may see, as `ScopedTabularStorage` does — simply does not implement
 * `joinDelegate`, and the chain stops at it. The loop is bounded by a visited
 * set so a wrapper that returns itself cannot hang the caller.
 */
export function resolveJoinDelegate(
  storage: ITabularStorage<any, any, any, any, any>
): ITabularStorage<any, any, any, any, any> {
  let current: ITabularStorage<any, any, any, any, any> = storage;
  const seen = new Set<unknown>([current]);
  while (isJoinDelegating(current)) {
    const next = current.joinDelegate() as ITabularStorage<any, any, any, any, any>;
    if (next === undefined || next === null || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}
