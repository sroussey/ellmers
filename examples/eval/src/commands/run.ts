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
  extract: "onnx-community/LFM2.5-350M-ONNX",
};

const DEFAULT_TEXT_COLUMN: Record<EvalKind, string> = {
  classify: "text",
  similarity: "sentence1",
  extract: "text",
};

const DESCRIPTIONS: Record<EvalKind, string> = {
  classify:
    "Classify each stored row with each model (StructuredGenerationTask) and score accuracy",
  similarity:
    "Embed stored sentence pairs with each model (TextEmbeddingTask) and correlate cosine similarity with the gold score",
  extract:
    "Extract structured records from each stored row (StructuredGenerationTask) and score field agreement, entity recall, and precision against the gold rows",
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
  readonly expectedColumn?: string | undefined;
  readonly keyField?: string | undefined;
  readonly fields?: string | undefined;
  readonly instruction?: string | undefined;
  readonly format: string;
}

export function registerRunCommand(
  program: Command,
  openStores: () => Promise<EvalStores>,
  ensureProviders: () => Promise<void>
): void {
  for (const kind of ["classify", "similarity", "extract"] as const) {
    const command = program
      .command(`run-${kind}`)
      .description(DESCRIPTIONS[kind])
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
    } else if (kind === "similarity") {
      command
        .option("--pair-column <name>", "second sentence column", "sentence2")
        .option("--score-column <name>", "gold score column", "score");
    } else {
      command
        .option("--expected-column <name>", "gold column: array of objects or JSON", "expected")
        .option("--key-field <name>", "field that identifies an entity when aligning", "name")
        .option("--fields <list>", "comma-separated fields to extract and score")
        .option("--instruction <text>", "task sentence at the top of the prompt");
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

/** Split a comma-separated flag, dropping empties from stray commas ("a,b," → [a, b]). */
function parseNameList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : undefined;
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
    labels: parseNameList(flags.labels),
    pairColumn: flags.pairColumn ?? "sentence2",
    scoreColumn: flags.scoreColumn ?? "score",
    expectedColumn: flags.expectedColumn ?? "expected",
    keyField: flags.keyField ?? "name",
    fields: parseNameList(flags.fields),
    instruction: flags.instruction,
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
