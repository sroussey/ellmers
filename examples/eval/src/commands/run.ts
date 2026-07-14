/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runSweep } from "../evals/runner";
import type { ColumnOptions, DatasetContext } from "../evals/types";
import type { LabelNames } from "../hf/types";
import type { EvalKind } from "../models";
import { parseModelList } from "../models";
import type { EvalStores } from "../storage";
import { formatError, parseIntFlag } from "../util";
import { printReport } from "./report";

const DEFAULT_MODELS: Record<EvalKind, string> = {
  classify: "onnx-community/LFM2.5-350M-ONNX",
  similarity: "Xenova/all-MiniLM-L6-v2",
};

const DEFAULT_TEXT_COLUMN: Record<EvalKind, string> = {
  classify: "text",
  similarity: "sentence1",
};

interface RunFlags {
  readonly dataset: string;
  readonly split: string;
  readonly models?: string | undefined;
  readonly limit?: string | undefined;
  readonly textColumn?: string | undefined;
  readonly labelColumn?: string | undefined;
  readonly labels?: string | undefined;
  readonly pairColumn?: string | undefined;
  readonly scoreColumn?: string | undefined;
  readonly format: string;
}

export function registerRunCommand(
  program: Command,
  openStores: () => Promise<EvalStores>,
  ensureProviders: () => Promise<void>
): void {
  for (const kind of ["classify", "similarity"] as const) {
    const description =
      kind === "classify"
        ? "Classify each stored row with each model (StructuredGenerationTask) and score accuracy"
        : "Embed stored sentence pairs with each model (TextEmbeddingTask) and correlate cosine similarity with the gold score";
    const command = program
      .command(`run-${kind}`)
      .description(description)
      .requiredOption("--dataset <id>", "a dataset previously stored via `dataset pull`")
      .option("--split <split>", "dataset split", "test")
      .option("--models <list>", `comma-separated model ids (default: ${DEFAULT_MODELS[kind]})`)
      .option("--limit <n>", "cap the number of stored rows to run")
      .option("--text-column <name>", `input text column (default: ${DEFAULT_TEXT_COLUMN[kind]})`)
      .option("--format <fmt>", "report output: table or json", "table");
    if (kind === "classify") {
      command
        .option("--label-column <name>", "gold label column", "label")
        .option("--labels <list>", "comma-separated candidate labels override");
    } else {
      command
        .option("--pair-column <name>", "second sentence column", "sentence2")
        .option("--score-column <name>", "gold score column", "score");
    }
    command.action(async (flags: RunFlags) => {
      try {
        await ensureProviders();
        await runEval(kind, flags, await openStores());
      } catch (err) {
        console.error(`Error: ${formatError(err)}`);
        process.exitCode = 1;
      }
    });
  }
}

async function runEval(kind: EvalKind, flags: RunFlags, stores: EvalStores): Promise<void> {
  const meta = await stores.datasets.get({ dataset: flags.dataset, split: flags.split });
  if (!meta) {
    throw new Error(
      `dataset ${flags.dataset} [${flags.split}] is not in storage — ` +
        `run \`workglow-eval dataset pull ${flags.dataset} --split ${flags.split}\` first`
    );
  }

  const rows = (await stores.rows.query({ dataset: flags.dataset, split: flags.split })) ?? [];
  rows.sort((a, b) => a.row_index - b.row_index);
  const limit = flags.limit === undefined ? undefined : parseIntFlag(flags.limit, "--limit", 1);
  const limited = limit === undefined ? rows : rows.slice(0, limit);
  if (limited.length === 0) throw new Error("no stored rows to evaluate");

  const models = parseModelList(flags.models ?? DEFAULT_MODELS[kind]);
  const columns: ColumnOptions = {
    textColumn: flags.textColumn ?? DEFAULT_TEXT_COLUMN[kind],
    labelColumn: flags.labelColumn ?? "label",
    labels: flags.labels ? flags.labels.split(",").map((l) => l.trim()) : undefined,
    pairColumn: flags.pairColumn ?? "sentence2",
    scoreColumn: flags.scoreColumn ?? "score",
  };
  const context: DatasetContext = {
    columns: JSON.parse(meta.columns) as string[],
    labelNames: meta.label_names ? (JSON.parse(meta.label_names) as LabelNames) : {},
  };

  console.error(
    `running ${kind} over ${limited.length} rows of ${flags.dataset} [${flags.split}] ` +
      `with ${models.length} model(s)`
  );
  const runId = await runSweep(stores, limited, {
    kind,
    dataset: flags.dataset,
    split: flags.split,
    models,
    columns,
    context,
    onProgress: (done, total, model, ok) => {
      console.error(`[${done}/${total}] ${model} ${ok ? "ok" : "FAIL"}`);
    },
  });

  console.error(`run ${runId} complete\n`);
  await printReport(stores, runId, flags.format);
}
