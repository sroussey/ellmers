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
 * per (dataset, split) plus one row per example. Re-pulling replaces the
 * stored split so `run` always sees exactly what the metadata row describes.
 */
export async function pullDatasetIntoStorage(
  stores: EvalStores,
  options: FetchDatasetOptions
): Promise<{ numRows: number; source: string }> {
  const fetched = await fetchDataset(options);
  const { dataset, split } = options;

  await stores.rows.deleteSearch({ dataset, split });
  await stores.rows.putBulk(
    fetched.rows.map((row, i) => ({
      dataset,
      split,
      row_index: (options.offset ?? 0) + i,
      data: JSON.stringify(row),
    }))
  );
  await stores.datasets.put({
    dataset,
    split,
    config: options.config ?? "",
    num_rows: fetched.rows.length,
    columns: JSON.stringify(fetched.columns),
    label_names:
      Object.keys(fetched.labelNames).length > 0 ? JSON.stringify(fetched.labelNames) : null,
    source: fetched.source,
    fetched_at: new Date().toISOString(),
  });

  return { numRows: fetched.rows.length, source: fetched.source };
}
