/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent, Usage } from "@workglow/task-graph";
import type { DatasetRow, LabelNames } from "../hf/types";

/** What one workflow execution produced for one dataset row. */
export interface RowPrediction {
  readonly expected?: string | undefined;
  readonly predicted?: string | undefined;
  readonly expectedValue?: number | undefined;
  readonly predictedValue?: number | undefined;
  readonly usage?: Usage | undefined;
}

/**
 * Runs the eval workflow for a single dataset row against one model.
 *
 * `onStreamChunk`, when passed, is subscribed to the row's underlying task for
 * the life of the call only — `--stream` is the only caller that passes it, so
 * an ordinary sweep never pays for the subscription.
 */
/**
 * How a row's work joins the run's single task graph.
 *
 * Each row builds its own small workflow. Run standalone those are invisible:
 * the run is one graph, and anything executed outside it is work no progress
 * surface can see. Handing the executor the sweep task's context lets it OWN
 * that workflow for the row's duration, so the row appears as a live child and
 * leaves when it finishes.
 */
export interface RowOwner {
  readonly context: IExecuteContext;
  /** Row label, e.g. `claude-haiku-4-5 · row 12`. */
  readonly title: string;
}

export type RowExecutor = (
  row: DatasetRow,
  onStreamChunk?: (event: StreamEvent) => void,
  owner?: RowOwner
) => Promise<RowPrediction>;

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
  /** extract: gold column holding an array of objects (or its JSON string). */
  readonly expectedColumn: string;
  /** extract: field that identifies an entity when aligning rows. */
  readonly keyField: string;
  /** extract: fields to request and score; defaults to keys seen in the gold rows. */
  readonly fields?: readonly string[] | undefined;
  /** extract: task sentence at the top of the prompt. */
  readonly instruction?: string | undefined;
}

export interface DatasetContext {
  readonly columns: readonly string[];
  readonly labelNames: LabelNames;
}
