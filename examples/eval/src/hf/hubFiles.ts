/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { gunzipSync } from "node:zlib";
import { hfAuthHeaders } from "./auth";
import { sanitizeHubFilePath, sanitizeHubRepoId } from "./ids";
import type { DatasetRow, FetchDatasetOptions, FetchedDataset, LabelNames } from "./types";

const HUB = "https://huggingface.co";

export interface HubTreeEntry {
  readonly type: "file" | "directory";
  readonly path: string;
}

const SUPPORTED_EXTENSIONS = [".parquet", ".jsonl.gz", ".jsonl", ".ndjson", ".json.gz", ".json"];

function fileExtension(path: string): string | undefined {
  const lower = path.toLowerCase();
  return SUPPORTED_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rank a repo file for a requested split. Data files on the hub conventionally
 * embed the split in the file name (`test-00000-of-00001.parquet`, `test.jsonl.gz`)
 * or live in a split-named directory. Returns undefined when the file cannot
 * belong to the split.
 */
export function scoreFileForSplit(path: string, split: string): number | undefined {
  if (!fileExtension(path)) return undefined;
  const lower = path.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  const s = split.toLowerCase();
  if (name === `${s}${fileExtension(name)}`) return 3;
  if (name.startsWith(`${s}-`) || name.startsWith(`${s}.`) || name.startsWith(`${s}_`)) return 2;
  if (new RegExp(`(^|[/_.-])${escapeRegExp(s)}([/_.-]|$)`).test(lower)) return 1;
  return undefined;
}

/** Pick the data files (shards, sorted) that best match the requested split. */
export function selectSplitFiles(files: readonly string[], split: string): string[] {
  let best = 0;
  let selected: string[] = [];
  for (const path of files) {
    const score = scoreFileForSplit(path, split) ?? 0;
    if (score > best) {
      best = score;
      selected = [path];
    } else if (score === best && score > 0) {
      selected.push(path);
    }
  }
  return selected.sort();
}

/**
 * JSON-safe copy of a value: BigInt (parquet int64, including inside list and
 * struct columns) → number, or a decimal string when the value exceeds the
 * safe-integer range so precision is preserved rather than corrupted; Date
 * (parquet timestamps) → ISO string. `JSON.stringify` throws on BigInt, so
 * this must recurse into containers.
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object" && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = sanitizeValue(inner);
    return out;
  }
  return value;
}

/** JSON-safe copy of a row; see {@link sanitizeValue}. */
export function sanitizeRow(row: DatasetRow): DatasetRow {
  return sanitizeValue(row) as DatasetRow;
}

export function parseJsonLines(text: string): DatasetRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DatasetRow);
}

/**
 * Parse one downloaded dataset file into rows (+ any `ClassLabel` names the
 * parquet footer carries). `limit` bounds how many rows are decoded.
 */
export async function parseDatasetFile(
  path: string,
  bytes: ArrayBuffer,
  limit: number
): Promise<{ rows: DatasetRow[]; labelNames: LabelNames }> {
  const ext = fileExtension(path);
  if (ext === ".parquet") {
    const metadata = await parquetMetadataAsync(bytes);
    const labelNames: Record<string, readonly string[]> = {};
    const hfMeta = metadata.key_value_metadata?.find((kv) => kv.key === "huggingface");
    if (hfMeta?.value) {
      try {
        const info = JSON.parse(hfMeta.value) as {
          info?: { features?: Record<string, { _type?: string; names?: string[] }> };
        };
        for (const [name, feature] of Object.entries(info.info?.features ?? {})) {
          if (feature?._type === "ClassLabel" && Array.isArray(feature.names)) {
            labelNames[name] = feature.names;
          }
        }
      } catch {
        // Footer metadata is advisory; ignore unparsable values.
      }
    }
    const rows = (await parquetReadObjects({
      file: bytes,
      compressors,
      metadata,
      rowEnd: limit,
    })) as DatasetRow[];
    return { rows: rows.map(sanitizeRow), labelNames };
  }

  const text = ext?.endsWith(".gz")
    ? gunzipSync(Buffer.from(bytes)).toString("utf-8")
    : new TextDecoder().decode(bytes);

  if (ext === ".json" || ext === ".json.gz") {
    const parsed = JSON.parse(text) as DatasetRow[] | { rows?: DatasetRow[]; data?: DatasetRow[] };
    const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed.data ?? []);
    return { rows: rows.slice(0, limit), labelNames: {} };
  }

  return { rows: parseJsonLines(text).slice(0, limit), labelNames: {} };
}

async function listRepoFiles(dataset: string, token: string | undefined): Promise<string[]> {
  const url = `${HUB}/api/datasets/${sanitizeHubRepoId(dataset)}/tree/main?recursive=true`;
  const res = await fetch(url, { headers: hfAuthHeaders(token) });
  if (!res.ok) {
    throw new Error(`hub tree listing failed (${res.status}) for dataset ${dataset}`);
  }
  const entries = (await res.json()) as HubTreeEntry[];
  return entries.filter((e) => e.type === "file").map((e) => e.path);
}

async function downloadRepoFile(
  dataset: string,
  path: string,
  token: string | undefined
): Promise<ArrayBuffer> {
  const url = `${HUB}/datasets/${sanitizeHubRepoId(dataset)}/resolve/main/${sanitizeHubFilePath(path)}`;
  const res = await fetch(url, { headers: hfAuthHeaders(token) });
  if (!res.ok) {
    throw new Error(`hub file download failed (${res.status}) for ${dataset}/${path}`);
  }
  return await res.arrayBuffer();
}

/**
 * Fetch rows by downloading the dataset's data files straight from the hub
 * (`huggingface.co/datasets/<id>/resolve/main/...`). Used when the datasets
 * viewer API is unreachable (e.g. restricted egress). Supports parquet,
 * jsonl(.gz), ndjson, and json(.gz) files.
 */
export async function fetchViaHubFiles(options: FetchDatasetOptions): Promise<FetchedDataset> {
  const { dataset, split, limit, token } = options;
  const allFiles = await listRepoFiles(dataset, token);
  const configFiles = options.config
    ? allFiles.filter((f) => f.startsWith(`${options.config}/`) || !f.includes("/"))
    : allFiles;
  const files = selectSplitFiles(configFiles, split);
  if (files.length === 0) {
    throw new Error(
      `no data files matching split "${split}" found in ${dataset} ` +
        `(supported: ${SUPPORTED_EXTENSIONS.join(", ")})`
    );
  }

  const offset = options.offset ?? 0;
  const wanted = offset + limit;
  const rows: DatasetRow[] = [];
  let labelNames: LabelNames = {};
  for (const file of files) {
    if (rows.length >= wanted) break;
    const bytes = await downloadRepoFile(dataset, file, token);
    const parsed = await parseDatasetFile(file, bytes, wanted - rows.length);
    rows.push(...parsed.rows);
    if (Object.keys(parsed.labelNames).length > 0) labelNames = parsed.labelNames;
  }

  const windowed = rows.slice(offset, wanted);
  const columns = [...new Set(windowed.flatMap((row) => Object.keys(row)))];
  return { rows: windowed, columns, labelNames, config: options.config ?? "", source: "hub-files" };
}
