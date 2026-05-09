/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";

/**
 * Consumes an `AsyncIterable<StreamEvent<T>>` and returns the fully-accumulated
 * output `T`.
 *
 * Two accumulation strategies are supported:
 *
 * **Delta accumulation** — when the stream yields `text-delta` or `object-delta`
 * events, their payloads are accumulated (text via concatenation; object deltas
 * via last-write-wins shallow merge across all ports). The final `finish` event's
 * `data` is then merged on top of the accumulated result.
 *
 * **One-shot** — when no delta events arrive and the `finish` event carries a
 * non-empty `data` payload, that payload is returned directly. This covers
 * capabilities such as embeddings, token counting, and classification where the
 * provider yields a single finish event.
 *
 * `snapshot` events replace the accumulated state for their port (replace-mode).
 *
 * `error` events cause an immediate throw.
 *
 * `phase` events are ignored (they are observability metadata, not data).
 *
 * @throws {Error} If the stream ends without a `finish` event.
 * @throws {Error} If the stream yields a `StreamError` event.
 */
export async function collectStream<T>(stream: AsyncIterable<StreamEvent<T>>): Promise<T> {
  let textAccumulator = "";
  let objectAccumulator: Record<string, unknown> = {};
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
        textAccumulator += event.textDelta;
        break;

      case "object-delta": {
        hasObjectDeltas = true;
        const delta = event.objectDelta;
        if (Array.isArray(delta)) {
          // Array delta: upsert by id into accumulated array
          const existing = (objectAccumulator[event.port] as unknown[]) ?? [];
          for (const item of delta) {
            if (
              item !== null &&
              typeof item === "object" &&
              "id" in (item as Record<string, unknown>)
            ) {
              const id = (item as Record<string, unknown>).id;
              const idx = existing.findIndex(
                (e) =>
                  e !== null &&
                  typeof e === "object" &&
                  (e as Record<string, unknown>).id === id
              );
              if (idx >= 0) {
                existing[idx] = { ...(existing[idx] as Record<string, unknown>), ...(item as Record<string, unknown>) };
              } else {
                existing.push(item);
              }
            } else {
              existing.push(item);
            }
          }
          objectAccumulator[event.port] = existing;
        } else {
          // Non-array: shallow merge (last snapshot wins per-key)
          objectAccumulator[event.port] = {
            ...((objectAccumulator[event.port] as Record<string, unknown>) ?? {}),
            ...(delta as Record<string, unknown>),
          };
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
        break;

      case "error":
        throw event.error;

      case "phase":
        // Metadata-only; not accumulated into output.
        break;
    }
  }

  if (!finished) {
    throw new Error("Stream ended without a finish event.");
  }

  // One-shot: no deltas, finish carries non-empty data.
  if (!hasTextDeltas && !hasObjectDeltas && !hasSnapshots) {
    if (finishData !== undefined && finishData !== null && Object.keys(finishData as object).length > 0) {
      return finishData;
    }
    // finish with empty data and no deltas — return the (empty) finish payload.
    return finishData as T;
  }

  // Snapshot (replace) mode — last snapshot wins, finish data merged on top.
  if (hasSnapshots && !hasTextDeltas && !hasObjectDeltas) {
    if (finishData !== undefined && finishData !== null && Object.keys(finishData as object).length > 0) {
      return { ...(snapshotAccumulator as object), ...(finishData as object) } as T;
    }
    return snapshotAccumulator as T;
  }

  // Text-delta mode — return concatenated string (cast to T).
  if (hasTextDeltas && !hasObjectDeltas) {
    return textAccumulator as unknown as T;
  }

  // Object-delta mode — merge finish data on top of accumulated object partials.
  const merged: Record<string, unknown> = { ...objectAccumulator };
  if (finishData !== undefined && finishData !== null && Object.keys(finishData as object).length > 0) {
    Object.assign(merged, finishData as object);
  }
  return merged as unknown as T;
}
