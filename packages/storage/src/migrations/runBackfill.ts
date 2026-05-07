/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage, PageCursor } from "../tabular/ITabularStorage";

/**
 * Backend-agnostic, page-based backfill loop. Iterates every row in the
 * storage in `batchSize`-row pages using cursor pagination so iteration
 * is stable under concurrent writes.
 *
 * For each row, calls `transform` and:
 *   - if it returns the **same reference** as the input, skips the write
 *     (the row is unchanged);
 *   - if it returns `undefined`, deletes the row;
 *   - otherwise, writes the new row via `put`.
 */
export async function runBackfill(
  storage: AnyTabularStorage,
  batchSize: number,
  transform: (
    row: Record<string, unknown>
  ) =>
    | Promise<Record<string, unknown> | undefined>
    | Record<string, unknown>
    | undefined
): Promise<void> {
  let cursor: PageCursor | undefined;
  while (true) {
    const page = await storage.getPage({ limit: batchSize, cursor });
    for (const row of page.items) {
      const out = await transform(row as Record<string, unknown>);
      if (out === row) continue;
      if (out === undefined) {
        await storage.delete(row);
      } else {
        await storage.put(out);
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
}
