/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";
import type { Usage } from "@workglow/task-graph";
import { USAGE_OUTPUT_KEY, Workflow } from "@workglow/task-graph";
import type { DatasetRow, LabelNames } from "../hf/types";
import { fenceText } from "./prompt";
import { runWithStreamChunks } from "./streamSubscribe";
import type { ColumnOptions, DatasetContext, RowExecutor } from "./types";

/**
 * Resolve the gold label for a row: integer-coded labels (HuggingFace
 * `ClassLabel`) are mapped through the dataset's label names, falling back to
 * the candidate label list (`--labels`) when the dataset doesn't declare
 * names; string labels pass through unchanged.
 */
export function expectedLabel(
  row: DatasetRow,
  labelColumn: string,
  labelNames: LabelNames,
  candidateLabels: readonly string[] = []
): string {
  const raw = row[labelColumn];
  if (typeof raw === "number" && Number.isInteger(raw)) {
    const names = labelNames[labelColumn] ?? candidateLabels;
    if (raw >= 0 && raw < names.length) return names[raw];
  }
  return String(raw);
}

/** The candidate label set: explicit flag, else the dataset's ClassLabel names. */
export function resolveCandidateLabels(
  options: ColumnOptions,
  context: DatasetContext
): readonly string[] {
  if (options.labels && options.labels.length > 0) return options.labels;
  const names = context.labelNames[options.labelColumn];
  if (names && names.length > 0) return names;
  throw new Error(
    `no candidate labels: dataset column "${options.labelColumn}" has no ClassLabel names — ` +
      `pass --labels "a,b,c"`
  );
}

export function buildClassifyPrompt(text: string, labels: readonly string[]): string {
  return (
    `Classify the following text into exactly one of these labels: ` +
    `${labels.join(", ")}.\n\n` +
    `Text:\n${fenceText(text)}\n\n` +
    `Respond with a JSON object of the form {"label": "<one of the labels>"}.`
  );
}

/**
 * Per-row classification workflow: a single StructuredGenerationTask whose
 * output schema constrains the label to the candidate set, so any model with
 * text generation + JSON mode (cloud or local ONNX) is comparable.
 */
export function makeClassifyExecutor(
  model: ModelConfig,
  options: ColumnOptions,
  context: DatasetContext
): RowExecutor {
  for (const column of [options.textColumn, options.labelColumn]) {
    if (context.columns.length > 0 && !context.columns.includes(column)) {
      throw new Error(
        `dataset has no column "${column}" (columns: ${context.columns.join(", ")}) — ` +
          `set --text-column/--label-column`
      );
    }
  }

  const labels = resolveCandidateLabels(options, context);
  const outputSchema = {
    type: "object",
    properties: { label: { type: "string", enum: [...labels] } },
    required: ["label"],
    additionalProperties: false,
  };

  return async (row, onStreamChunk, owner) => {
    const text = String(row[options.textColumn] ?? "");
    const workflow = new Workflow();
    workflow.structuredGeneration({
      model,
      prompt: buildClassifyPrompt(text, labels),
      outputSchema,
      temperature: 0,
      maxTokens: 256,
    });
    const output = await runWithStreamChunks<{
      object?: { label?: unknown };
      [USAGE_OUTPUT_KEY]?: Usage;
    }>(workflow, onStreamChunk, owner);
    return {
      expected: expectedLabel(row, options.labelColumn, context.labelNames, labels),
      predicted: String(output.object?.label ?? ""),
      usage: output[USAGE_OUTPUT_KEY],
    };
  };
}
