/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from "@workglow/util";
import type { TypedArray } from "@workglow/util/schema";
import { safeEmit } from "../events/safeEmit";
import type { VectorEventListeners } from "./IVectorStorage";

/**
 * Emit the `similaritySearch` event declared on {@link VectorEventListeners}
 * and pass the results through, so `similaritySearch()` implementations can
 * tail-call it.
 *
 * Every vector storage inherits its `events` emitter from its tabular base,
 * where the emitter is typed for the tabular event surface only. The emitter
 * instance is the same object, so the widening cast to the vector event map
 * lives here once instead of being repeated in every backend.
 */
export function emitSimilaritySearch<Entity>(
  events: EventEmitter<any>,
  query: TypedArray,
  results: Array<Entity & { score: number }>
): Array<Entity & { score: number }> {
  safeEmit(
    events as EventEmitter<Pick<VectorEventListeners<unknown, Entity>, "similaritySearch">>,
    "similaritySearch",
    query,
    results
  );
  return results;
}
