/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hfAuthHeaders } from "./auth";
import type { DatasetRow, FetchDatasetOptions, FetchedDataset, LabelNames } from "./types";

const DATASETS_SERVER = "https://datasets-server.huggingface.co";
/** The server caps `length` at 100 rows per request. */
const PAGE_SIZE = 100;

interface RowsResponseFeature {
  readonly name: string;
  readonly type: { readonly _type?: string; readonly names?: readonly string[] } | unknown;
}

interface RowsResponse {
  readonly features: readonly RowsResponseFeature[];
  readonly rows: readonly {
    readonly row_idx: number;
    readonly row: DatasetRow;
    readonly truncated_cells?: readonly string[];
  }[];
  readonly num_rows_total: number;
}

async function getJson<T>(url: string, token: string | undefined): Promise<T> {
  const res = await fetch(url, { headers: hfAuthHeaders(token) });
  if (!res.ok) {
    throw new Error(`datasets-server request failed (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}

/** Resolve the default config name for a dataset (the first one reported). */
async function resolveConfig(dataset: string, token: string | undefined): Promise<string> {
  const data = await getJson<{ splits: readonly { config: string }[] }>(
    `${DATASETS_SERVER}/splits?dataset=${encodeURIComponent(dataset)}`,
    token
  );
  const config = data.splits[0]?.config;
  if (!config) throw new Error(`datasets-server reported no configs for ${dataset}`);
  return config;
}

function extractLabelNames(features: readonly RowsResponseFeature[]): LabelNames {
  const labelNames: Record<string, readonly string[]> = {};
  for (const feature of features) {
    const type = feature.type as { _type?: string; names?: readonly string[] } | undefined;
    if (type?._type === "ClassLabel" && Array.isArray(type.names)) {
      labelNames[feature.name] = type.names;
    }
  }
  return labelNames;
}

/**
 * Fetch rows through the HuggingFace datasets viewer API
 * (`datasets-server.huggingface.co/rows`). Works for any public dataset the
 * viewer has processed and includes `ClassLabel` names so integer label
 * columns can be mapped back to strings.
 */
export async function fetchViaDatasetsServer(
  options: FetchDatasetOptions
): Promise<FetchedDataset> {
  const { dataset, split, limit, token } = options;
  const config = options.config ?? (await resolveConfig(dataset, token));
  const offset = options.offset ?? 0;

  const rows: DatasetRow[] = [];
  let columns: readonly string[] = [];
  let labelNames: LabelNames = {};
  let truncatedRows = 0;

  while (rows.length < limit) {
    const length = Math.min(PAGE_SIZE, limit - rows.length);
    const url =
      `${DATASETS_SERVER}/rows?dataset=${encodeURIComponent(dataset)}` +
      `&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}` +
      `&offset=${offset + rows.length}&length=${length}`;
    const page = await getJson<RowsResponse>(url, token);
    if (rows.length === 0) {
      columns = page.features.map((f) => f.name);
      labelNames = extractLabelNames(page.features);
    }
    for (const r of page.rows) {
      if (r.truncated_cells && r.truncated_cells.length > 0) truncatedRows++;
      rows.push(r.row);
    }
    if (page.rows.length < length || offset + rows.length >= page.num_rows_total) break;
  }

  if (truncatedRows > 0) {
    console.error(
      `warning: the datasets viewer truncated large cells in ${truncatedRows} row(s); ` +
        `evals will run on the truncated text`
    );
  }

  return { rows, columns, labelNames, config, source: "datasets-server" };
}
