/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EvalStores } from "../storage";
import { fetchViaDatasetsServer } from "./datasetsServer";
import { fetchViaHubFiles } from "./hubFiles";
import type { FetchDatasetOptions, FetchedDataset } from "./types";

/**
 * Fetch dataset rows, preferring the datasets viewer API (typed features,
 * server-side pagination) and falling back to downloading the repo's data
 * files directly when the viewer is unreachable.
 */
export async function fetchDataset(options: FetchDatasetOptions): Promise<FetchedDataset> {
  try {
    return await fetchViaDatasetsServer(options);
  } catch (err) {
    console.error(
      `datasets-server unavailable (${err instanceof Error ? err.message : String(err)}); ` +
        `falling back to direct hub file download`
    );
    return await fetchViaHubFiles(options);
  }
}

/**
 * Fetch a dataset split and persist it into tabular storage: one metadata row
 * per (dataset, split) plus one row per example. A plain re-pull replaces the
 * stored split; a pull with `--offset` extends it (only rows from the offset
 * onward are replaced), so a split can be paged in incrementally. The replace
 * runs in a transaction so a failed pull cannot leave the split half-wiped
 * (real rollback on SQLite; best-effort on backends without transactions).
 */
export async function pullDatasetIntoStorage(
  stores: EvalStores,
  options: FetchDatasetOptions
): Promise<{ numRows: number; source: string }> {
  const fetched = await fetchDataset(options);
  const { dataset, split } = options;
  const offset = options.offset ?? 0;

  await stores.rows.withTransaction(async (tx) => {
    if (offset > 0) {
      await tx.deleteSearch({ dataset, split, row_index: { value: offset, operator: ">=" } });
    } else {
      await tx.deleteSearch({ dataset, split });
    }
    await tx.putBulk(
      fetched.rows.map((row, i) => ({
        dataset,
        split,
        row_index: offset + i,
        data: JSON.stringify(row),
      }))
    );
  });

  const numRows = await stores.rows.count({ dataset, split });
  await stores.datasets.put({
    dataset,
    split,
    config: fetched.config || (options.config ?? ""),
    num_rows: numRows,
    columns: JSON.stringify(fetched.columns),
    label_names:
      Object.keys(fetched.labelNames).length > 0 ? JSON.stringify(fetched.labelNames) : null,
    source: fetched.source,
    fetched_at: new Date().toISOString(),
  });

  return { numRows, source: fetched.source };
}
