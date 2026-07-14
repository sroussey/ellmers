/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import type { EvalKind } from "../models";
import { aggregateResults } from "../report/aggregate";
import type { EvalStores } from "../storage";
import { formatError, formatMetric, formatTable } from "../util";

/** Render the report for one stored run to stdout (table or json). */
export async function printReport(
  stores: EvalStores,
  runId: string,
  format: string
): Promise<void> {
  const run = await stores.runs.get({ run_id: runId });
  if (!run) throw new Error(`run ${runId} not found`);
  const results = (await stores.results.query({ run_id: runId })) ?? [];
  const reports = aggregateResults(run.kind as EvalKind, results);

  if (format === "json") {
    console.log(JSON.stringify({ run, reports }, null, 2));
    return;
  }

  console.log(`run ${run.run_id} — ${run.kind} on ${run.dataset} [${run.split}]`);
  const columns =
    run.kind === "classify"
      ? ["model", "rows", "ok", "accuracy", "avg_ms"]
      : ["model", "rows", "ok", "pearson", "spearman", "avg_ms"];
  const tableRows = reports.map((r) => ({
    model: r.model,
    rows: String(r.rows),
    ok: String(r.okRows),
    accuracy: formatMetric(r.accuracy),
    pearson: formatMetric(r.pearson),
    spearman: formatMetric(r.spearman),
    avg_ms: formatMetric(r.avgLatencyMs, 0),
  }));
  console.log(formatTable(tableRows, columns));

  const failures = results.filter((r) => r.ok !== 1);
  if (failures.length > 0) {
    const sample = failures[0];
    console.log(
      `\n${failures.length} failed execution(s); first: ` +
        `${sample.model} row ${sample.row_index}: ${sample.error ?? "unknown error"}`
    );
  }
}

export function registerReportCommand(
  program: Command,
  openStores: () => Promise<EvalStores>
): void {
  program
    .command("runs")
    .description("List stored eval runs")
    .action(async () => {
      const stores = await openStores();
      const all = (await stores.runs.getAll()) ?? [];
      all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const rows = all.map((r) => ({
        run: r.run_id,
        kind: r.kind,
        dataset: `${r.dataset} [${r.split}]`,
        models: (JSON.parse(r.models) as string[]).join(","),
        created: r.created_at,
      }));
      console.log(formatTable(rows, ["run", "kind", "dataset", "models", "created"]));
    });

  program
    .command("report")
    .argument("[runId]", "run id (defaults to the most recent run)")
    .option("--format <fmt>", "table or json", "table")
    .description("Score a stored run and rank its models")
    .action(async (runId: string | undefined, opts: { format: string }) => {
      const stores = await openStores();
      try {
        let target = runId;
        if (!target) {
          const all = (await stores.runs.getAll()) ?? [];
          all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          target = all[0]?.run_id;
        }
        if (!target) throw new Error("no stored runs — run `run-classify` or `run-similarity`");
        await printReport(stores, target, opts.format);
      } catch (err) {
        console.error(`Error: ${formatError(err)}`);
        process.exitCode = 1;
      }
    });
}
