/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import type { EvalKind } from "../models";
import { aggregateResults, sumUsageColumns } from "../report/aggregate";
import type { EvalResultRecord, EvalStores } from "../storage";
import { formatError, formatMetric, formatTable } from "../util";

/** Render the report for one stored run to stdout (table or json). */
export async function printReport(
  stores: EvalStores,
  runId: string,
  format: string
): Promise<void> {
  const run = await stores.runs.get({ run_id: runId });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.kind !== "classify" && run.kind !== "similarity" && run.kind !== "extract") {
    throw new Error(`run ${runId} has unknown eval kind "${run.kind}"`);
  }
  const kind: EvalKind = run.kind;
  const results = (await stores.results.query({ run_id: runId })) ?? [];
  // Extract runs re-score their stored row JSON, which needs the key/field
  // options the sweep ran with; those live on the run record. A malformed
  // options blob falls back to the defaults rather than sinking the report.
  let runOptions: { keyField?: string; fields?: readonly string[] } = {};
  if (kind === "extract") {
    try {
      const parsed = JSON.parse(run.options) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        runOptions = parsed as { keyField?: string; fields?: readonly string[] };
      }
    } catch {
      // fall through with defaults
    }
  }
  const reports = aggregateResults(kind, results, runOptions);

  if (format === "json") {
    console.log(JSON.stringify({ run, reports }, null, 2));
    return;
  }

  console.log(`run ${run.run_id} — ${run.kind} on ${run.dataset} [${run.split}]`);
  const REPORT_COLUMNS: Record<EvalKind, string[]> = {
    classify: ["model", "rows", "ok", "accuracy", "avg_ms", "tokens", "cached", "cost"],
    similarity: [
      "model",
      "rows",
      "ok",
      "pearson",
      "spearman",
      "avg_ms",
      "tokens",
      "cached",
      "cost",
    ],
    extract: [
      "model",
      "rows",
      "ok",
      "score",
      "found",
      "prec",
      "avg_ms",
      "tokens",
      "cached",
      "cost",
    ],
  };
  const resultsByModel = new Map<string, EvalResultRecord[]>();
  for (const result of results) {
    const list = resultsByModel.get(result.model) ?? [];
    list.push(result);
    resultsByModel.set(result.model, list);
  }
  const tableRows = reports.map((r) => {
    const totals = sumUsageColumns(resultsByModel.get(r.model) ?? []);
    return {
      model: r.model,
      rows: String(r.rows),
      ok: String(r.okRows),
      accuracy: formatMetric(r.accuracy),
      pearson: formatMetric(r.pearson),
      spearman: formatMetric(r.spearman),
      score: formatMetric(r.score),
      found: formatMetric(r.found),
      prec: formatMetric(r.prec),
      avg_ms: formatMetric(r.avgLatencyMs, 0),
      tokens: `${totals.inputTokens ?? "-"}/${totals.outputTokens ?? "-"}`,
      cached: String(totals.cachedTokens ?? "-"),
      cost: totals.cost === undefined ? "-" : `$${totals.cost.toFixed(4)}`,
    };
  });
  console.log(formatTable(tableRows, REPORT_COLUMNS[kind]));

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
      all.sort((a, b) => b.created_at.localeCompare(a.created_at));
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
          all.sort((a, b) => b.created_at.localeCompare(a.created_at));
          target = all[0]?.run_id;
        }
        if (!target) {
          throw new Error(
            "no stored runs — run `run-classify`, `run-similarity`, or `run-extract`"
          );
        }
        await printReport(stores, target, opts.format);
      } catch (err) {
        console.error(`Error: ${formatError(err)}`);
        process.exitCode = 1;
      }
    });
}
