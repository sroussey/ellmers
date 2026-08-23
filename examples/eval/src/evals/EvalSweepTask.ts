/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { DatasetRowRecord, EvalStores } from "../storage";
import { runSweep, type SweepOptions } from "./runner";

const INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

const OUTPUT = {
  type: "object",
  properties: {
    run_id: { type: "string", title: "Run id" },
    rows: { type: "number", title: "Dataset rows" },
    models: { type: "number", title: "Models swept" },
  },
  required: ["run_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface EvalSweepTaskOutput {
  readonly run_id: string;
  readonly rows: number;
  readonly models: number;
}

/** An `interface` carries no index signature; the mapped form is what `DataPorts` accepts. */
type Ports<T> = { [K in keyof T]: T[K] };

/**
 * Runs one sweep as a task, so the run has a graph.
 *
 * The sweep is a nested loop over models and rows, and each row is its own
 * small workflow — so putting every row through the CLI seam would report one
 * RUN per row: fifteen hundred of them for a 500-row sweep of three models,
 * which is not a graph anyone can read. One task for the sweep is the honest
 * unit: it is what the operator started, and its progress is what they want to
 * watch.
 *
 * The stores, rows and options are passed as construction state rather than as
 * ports. They are live handles and parsed dataset records, not values a form
 * could supply or a cache could serialize.
 */
export class EvalSweepTask extends Task<Record<string, never>, Ports<EvalSweepTaskOutput>> {
  static override readonly type = "EvalSweepTask";
  static override readonly category = "Eval";
  static override readonly title = "Run eval sweep";
  static override readonly cacheable = false;

  static override inputSchema(): DataPortSchema {
    return INPUT;
  }
  static override outputSchema(): DataPortSchema {
    return OUTPUT;
  }

  #stores: EvalStores | undefined;
  #rows: readonly DatasetRowRecord[] = [];
  #options: SweepOptions | undefined;

  /** Hands the task the live handles a port cannot carry. */
  withSweep(stores: EvalStores, rows: readonly DatasetRowRecord[], options: SweepOptions): this {
    this.#stores = stores;
    this.#rows = rows;
    this.#options = options;
    return this;
  }

  override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<Ports<EvalSweepTaskOutput>> {
    const stores = this.#stores;
    const options = this.#options;
    if (!stores || !options) throw new Error("EvalSweepTask.withSweep was never called");

    await context.updateProgress(
      0,
      `${this.#rows.length} rows × ${options.models.length} model(s)`
    );
    const run_id = await runSweep(stores, this.#rows, {
      ...options,
      onProgress: (done, total, model, ok, usage) => {
        // The caller's own reporter still runs — it owns the stderr tally —
        // and the percentage rides alongside it so a watching console shows
        // the same sweep advancing.
        options.onProgress?.(done, total, model, ok, usage);
        void context.updateProgress(
          total > 0 ? (done / total) * 100 : 0,
          `${model} · ${done}/${total}`
        );
      },
    });
    return { run_id, rows: this.#rows.length, models: options.models.length };
  }
}
