/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatasetRow, LabelNames } from "../hf/types";

/** What one workflow execution produced for one dataset row. */
export interface RowPrediction {
  readonly expected?: string | undefined;
  readonly predicted?: string | undefined;
  readonly expectedValue?: number | undefined;
  readonly predictedValue?: number | undefined;
}

/** Runs the eval workflow for a single dataset row against one model. */
export type RowExecutor = (row: DatasetRow) => Promise<RowPrediction>;

export interface ColumnOptions {
  readonly textColumn: string;
  /** classify: gold label column. */
  readonly labelColumn: string;
  /** classify: candidate labels; defaults to the dataset's ClassLabel names. */
  readonly labels?: readonly string[] | undefined;
  /** similarity: second sentence column. */
  readonly pairColumn: string;
  /** similarity: gold similarity score column. */
  readonly scoreColumn: string;
}

export interface DatasetContext {
  readonly columns: readonly string[];
  readonly labelNames: LabelNames;
}
