/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How many deletions are in flight at once. Each is a separate `unlink` (or an
 * equivalent round-trip on another backing), so issuing them one after the
 * other makes cleanup latency the item count times a syscall round-trip;
 * issuing all of them at once would hand a run that wrote thousands of rows an
 * unbounded fan-out of open file operations.
 */
export const ROW_DELETE_CONCURRENCY = 16;

/**
 * Delete `items` with at most {@link ROW_DELETE_CONCURRENCY} deletions in
 * flight. Shared by the row cleanup in `FsFolderTaskOutputRepository` and the
 * blob-by-ref cleanup in `RunPrivateCacheRepo`, so both halves of a run's
 * cleanup are bounded by the same width.
 */
export async function deleteBounded<T>(
  items: readonly T[],
  deleteOne: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers: Promise<void>[] = [];
  const width = Math.min(ROW_DELETE_CONCURRENCY, items.length);
  for (let i = 0; i < width; i++) {
    workers.push(
      (async () => {
        while (next < items.length) {
          await deleteOne(items[next++]);
        }
      })()
    );
  }
  await Promise.all(workers);
}
