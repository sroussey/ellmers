/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** A dataset row as a plain JSON object keyed by column name. */
export type DatasetRow = Record<string, unknown>;

/**
 * Integer-coded label columns and their string names, as declared by the
 * dataset (HuggingFace `ClassLabel` features). Keyed by column name.
 */
export type LabelNames = Record<string, readonly string[]>;

export interface FetchedDataset {
  readonly rows: readonly DatasetRow[];
  readonly columns: readonly string[];
  readonly labelNames: LabelNames;
  /** The config the rows came from ("" when unknown, e.g. unfiltered hub files). */
  readonly config: string;
  /** Which fetch path produced the rows. */
  readonly source: "datasets-server" | "hub-files";
}

export interface FetchDatasetOptions {
  readonly dataset: string;
  /** Dataset config name; defaults to the first config the server reports. */
  readonly config?: string | undefined;
  readonly split: string;
  /** Maximum number of rows to fetch. */
  readonly limit: number;
  readonly offset?: number | undefined;
  /** HF access token for gated/private datasets (defaults to HF_TOKEN env). */
  readonly token?: string | undefined;
}
