/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";

/**
 * Returns true only for non-null, non-array objects with at least one own key.
 * Handles primitives, arrays, and `null` safely.
 */
const isNonEmptyObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;

/**
 * Consumes an `AsyncIterable<StreamEvent<T>>` and returns the fully-accumulated
 * output `T`.
 *
 * Two accumulation strategies are supported:
 *
 * **Delta accumulation** — when the stream yields `text-delta` or `object-delta`
 * events, their payloads are accumulated per-port. Text deltas are concatenated
 * per-port (`Map<string, string>`); the result is built as `{ [port]: text }` so
 * multi-port streams are preserved correctly. Object deltas use **replace**
 * semantics for non-array payloads (each delta is a progressively more complete
 * partial object snapshot — replace, not merge) and upsert-by-`id` semantics for
 * array payloads. Both strategies match `StreamProcessor`'s exact accumulation
 * logic.
 *
 * **One-shot** — when no delta events arrive and the `finish` event carries a
 * non-empty `data` payload, that payload is returned directly. This covers
 * capabilities such as embeddings, token counting, and classification where the
 * provider yields a single finish event.
 *
 * **Replace (snapshot) mode** — `snapshot` events update the running state;
 * the last snapshot wins. `finish.data` is merged on top if non-empty.
 *
 * **Mixed-mode streams** — a stream that yields both `text-delta` and
 * `object-delta` events is not supported; an error is thrown rather than
 * silently dropping one accumulator's contents.
 *
 * **First finish wins** — as soon as the first `finish` event is processed,
 * the loop breaks. Subsequent events (including duplicate `finish` events)
 * cannot corrupt the result.
 *
 * **Single-port text constraint** — multi-port text-delta streams are supported;
 * the result object is `{ [port]: accumulatedText, ... }` cast to `T`.
 *
 * `error` events cause an immediate throw (even after partial accumulation).
 *
 * `phase` events are ignored (they are observability metadata, not data).
 *
 * @throws {Error} If the stream ends without a `finish` event.
 * @throws {Error} If the stream yields a `StreamError` event.
 * @throws {Error} If the stream mixes `text-delta` and `object-delta` events.
 */
export async function collectStream<T>(stream: AsyncIterable<StreamEvent<T>>): Promise<T> {
  // Per-port accumulators — matches StreamProcessor exactly.
  const textAccumulator = new Map<string, string>();
  const objectAccumulator = new Map<string, Record<string, unknown> | unknown[]>();

  let hasTextDeltas = false;
  let hasObjectDeltas = false;
  let hasSnapshots = false;
  let snapshotAccumulator: T | undefined = undefined;
  let finished = false;
  let finishData: T | undefined = undefined;

  for await (const event of stream) {
    switch (event.type) {
      case "text-delta":
        hasTextDeltas = true;
        textAccumulator.set(event.port, (textAccumulator.get(event.port) ?? "") + event.textDelta);
        break;

      case "object-delta": {
        hasObjectDeltas = true;
        const delta = event.objectDelta;
        if (Array.isArray(delta)) {
          // Array delta: upsert items by `id` into the accumulated array.
          // Matches StreamProcessor lines 125-138.
          const existing: unknown[] = (() => {
            const e = objectAccumulator.get(event.port);
            return Array.isArray(e) ? [...e] : [];
          })();
          for (const item of delta) {
            const itemObj = item as Record<string, unknown>;
            if (itemObj && typeof itemObj === "object" && "id" in itemObj) {
              const idx = existing.findIndex(
                (e) => (e as Record<string, unknown>).id === itemObj.id
              );
              if (idx >= 0) existing[idx] = item;
              else existing.push(item);
            } else {
              existing.push(item);
            }
          }
          objectAccumulator.set(event.port, existing);
        } else {
          // Non-array (structured generation): replace semantics — each delta is a
          // progressively more complete partial object snapshot. Matches
          // StreamProcessor line 141: accumulatedObjects.set(event.port, event.objectDelta)
          objectAccumulator.set(event.port, delta as Record<string, unknown>);
        }
        break;
      }

      case "snapshot":
        hasSnapshots = true;
        snapshotAccumulator = event.data;
        break;

      case "finish":
        finished = true;
        finishData = event.data;
        // First finish wins — break immediately so no subsequent event can
        // corrupt the result (including duplicate finish events).
        break;

      case "error":
        throw event.error;

      case "phase":
        // Metadata-only; not accumulated into output.
        break;
    }

    if (finished) break;
  }

  if (!finished) {
    throw new Error("Stream ended without a finish event.");
  }

  // Mixed-mode guard: text-delta and object-delta in same stream is unsupported.
  if (hasTextDeltas && hasObjectDeltas) {
    throw new Error(
      "collectStream: stream mixed text-delta and object-delta events. " +
        "Mixed-mode streams are not supported; cannot build a single result from both accumulators."
    );
  }

  // One-shot: no deltas, no snapshots — finish carries the complete payload.
  if (!hasTextDeltas && !hasObjectDeltas && !hasSnapshots) {
    if (isNonEmptyObject(finishData)) {
      return finishData as unknown as T;
    }
    // finish with empty data and no deltas — return the (empty) finish payload.
    return finishData as T;
  }

  // Snapshot (replace) mode — last snapshot wins, finish data merged on top.
  if (hasSnapshots && !hasTextDeltas && !hasObjectDeltas) {
    if (isNonEmptyObject(finishData)) {
      return { ...(snapshotAccumulator as object), ...(finishData as object) } as T;
    }
    return snapshotAccumulator as T;
  }

  // Text-delta mode — return per-port map as result object (cast to T).
  // Keys are port names; values are the concatenated text for that port.
  if (hasTextDeltas && !hasObjectDeltas) {
    const result: Record<string, unknown> = {};
    for (const [port, text] of textAccumulator) {
      result[port] = text;
    }
    // Merge finish data on top if non-empty (e.g. additional metadata ports).
    if (isNonEmptyObject(finishData)) {
      Object.assign(result, finishData);
    }
    return result as unknown as T;
  }

  // Object-delta mode — assemble result from per-port accumulated objects,
  // then merge finish data on top.
  const merged: Record<string, unknown> = {};
  for (const [port, obj] of objectAccumulator) {
    merged[port] = obj;
  }
  if (isNonEmptyObject(finishData)) {
    Object.assign(merged, finishData as object);
  }
  return merged as unknown as T;
}
