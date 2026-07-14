/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";
import type { DatasetRow } from "../hf/types";
import type { EvalKind } from "../models";
import { ensureEmbeddingDimensions, ensureModelDownloaded, resolveModelConfig } from "../models";
import type { DatasetRowRecord, EvalStores } from "../storage";
import { makeClassifyExecutor } from "./classify";
import { makeSimilarityExecutor } from "./similarity";
import type { ColumnOptions, DatasetContext, RowExecutor } from "./types";

export interface SweepOptions {
  readonly kind: EvalKind;
  readonly dataset: string;
  readonly split: string;
  readonly models: readonly string[];
  readonly columns: ColumnOptions;
  readonly context: DatasetContext;
  readonly onProgress?:
    ((done: number, total: number, model: string, ok: boolean) => void) | undefined;
}

function makeExecutor(
  kind: EvalKind,
  model: ModelConfig,
  columns: ColumnOptions,
  context: DatasetContext
): RowExecutor {
  return kind === "classify"
    ? makeClassifyExecutor(model, columns, context)
    : makeSimilarityExecutor(model, columns, context);
}

/**
 * Run every stored dataset row through the eval workflow for each model,
 * persisting one result row per (run, model, dataset row). Failures are
 * recorded (`ok: 0` + error) rather than aborting the sweep, so one bad model
 * or one bad row never loses the rest of the run.
 */
export async function runSweep(
  stores: EvalStores,
  rows: readonly DatasetRowRecord[],
  options: SweepOptions
): Promise<string> {
  const run = await stores.runs.put({
    kind: options.kind,
    dataset: options.dataset,
    split: options.split,
    models: JSON.stringify(options.models),
    options: JSON.stringify(options.columns),
    created_at: new Date().toISOString(),
  });

  // Rows are model-independent: parse each once for the whole sweep, and turn
  // an unparseable row into a per-row failure instead of aborting.
  const parsedRows = rows.map((record) => {
    try {
      return { record, row: JSON.parse(record.data) as DatasetRow, parseError: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { record, row: undefined, parseError: `invalid stored row: ${message}` };
    }
  });

  const total = rows.length * options.models.length;
  let done = 0;

  for (const modelId of options.models) {
    let executor: RowExecutor | undefined;
    let setupError: string | undefined;
    try {
      let config = resolveModelConfig(modelId, options.kind);
      if (options.kind === "similarity") config = await ensureEmbeddingDimensions(config);
      await ensureModelDownloaded(config);
      executor = makeExecutor(options.kind, config, options.columns, options.context);
    } catch (err) {
      setupError = err instanceof Error ? err.message : String(err);
    }

    for (const { record, row, parseError } of parsedRows) {
      const t0 = performance.now();
      let outcome: SweepOutcome;
      if (!executor) {
        outcome = failedOutcome(setupError ?? "executor unavailable");
      } else if (!row) {
        outcome = failedOutcome(parseError ?? "invalid stored row");
      } else {
        try {
          const prediction = await executor(row);
          outcome = {
            ok: 1,
            error: null,
            expected: prediction.expected ?? null,
            predicted: prediction.predicted ?? null,
            expected_value: prediction.expectedValue ?? null,
            predicted_value: prediction.predictedValue ?? null,
          };
        } catch (err) {
          outcome = failedOutcome(err instanceof Error ? err.message : String(err));
        }
      }
      const latency = performance.now() - t0;
      await stores.results.put({
        run_id: run.run_id,
        model: modelId,
        row_index: record.row_index,
        latency_ms: Math.round(latency * 100) / 100,
        ...outcome,
      });
      done++;
      options.onProgress?.(done, total, modelId, outcome.ok === 1);
    }
  }

  return run.run_id;
}

interface SweepOutcome {
  readonly ok: number;
  readonly error: string | null;
  readonly expected: string | null;
  readonly predicted: string | null;
  readonly expected_value: number | null;
  readonly predicted_value: number | null;
}

function failedOutcome(error: string): SweepOutcome {
  return {
    ok: 0,
    error,
    expected: null,
    predicted: null,
    expected_value: null,
    predicted_value: null,
  };
}
