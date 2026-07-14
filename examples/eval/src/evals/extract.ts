/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import type { ExtractedRow } from "../score/extraction";
import type { ColumnOptions, DatasetContext, RowExecutor } from "./types";

const DEFAULT_INSTRUCTION = "Extract every entity mentioned in the text.";

/**
 * Parse a gold extraction column: parquet struct/list columns and
 * datasets-server JSON arrive as real arrays of objects; string columns hold
 * JSON. Anything else is a data error surfaced as a per-row failure.
 */
export function parseExpectedRows(value: unknown, column: string): ExtractedRow[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || parsed.some((row) => row === null || typeof row !== "object")) {
    throw new Error(`column "${column}" must hold an array of objects (or its JSON string)`);
  }
  return parsed as ExtractedRow[];
}

/** The fields to extract and score: explicit flag, else keys seen in the gold rows. */
export function resolveExtractionFields(
  expectedRows: readonly ExtractedRow[],
  keyField: string,
  fields: readonly string[] | undefined
): string[] {
  if (fields && fields.length > 0) {
    return fields.includes(keyField) ? [...fields] : [keyField, ...fields];
  }
  const seen = new Set<string>([keyField]);
  for (const row of expectedRows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

export function buildExtractPrompt(
  text: string,
  instruction: string,
  keyField: string,
  fields: readonly string[]
): string {
  return (
    `${instruction}\n\n` +
    `For each one, report the fields: ${fields.join(", ")}. ` +
    `"${keyField}" identifies the entity; leave a field out if the text does not state it.\n\n` +
    `Text:\n"""\n${text}\n"""\n\n` +
    `Respond with a JSON object of the form {"items": [{"${keyField}": "...", ...}, ...]}. ` +
    `Report each entity once; use only information from the text.`
  );
}

/**
 * Per-row extraction workflow: a single StructuredGenerationTask whose output
 * schema is an `items` array of objects keyed by the alignment field, so any
 * model with text generation + JSON mode is comparable. The gold column
 * supplies the expected rows; scoring aligns candidate items to them by
 * `keyField` (see {@link scoreExtraction}).
 */
export function makeExtractExecutor(
  model: ModelConfig,
  options: ColumnOptions,
  context: DatasetContext
): RowExecutor {
  for (const column of [options.textColumn, options.expectedColumn]) {
    if (context.columns.length > 0 && !context.columns.includes(column)) {
      throw new Error(
        `dataset has no column "${column}" (columns: ${context.columns.join(", ")}) — ` +
          `set --text-column/--expected-column`
      );
    }
  }
  const instruction = options.instruction ?? DEFAULT_INSTRUCTION;

  return async (row) => {
    const text = String(row[options.textColumn] ?? "");
    const expectedRows = parseExpectedRows(row[options.expectedColumn], options.expectedColumn);
    const fields = resolveExtractionFields(expectedRows, options.keyField, options.fields);

    const itemProperties: Record<string, unknown> = {};
    for (const field of fields) itemProperties[field] = { type: "string" };
    const outputSchema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: itemProperties,
            required: [options.keyField],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    };

    const workflow = new Workflow();
    workflow.structuredGeneration({
      model,
      prompt: buildExtractPrompt(text, instruction, options.keyField, fields),
      outputSchema,
      temperature: 0,
      maxTokens: 2048,
    });
    const result = (await workflow.run()) as { object?: { items?: unknown } };
    const items = Array.isArray(result.object?.items)
      ? (result.object.items as ExtractedRow[])
      : [];
    return {
      expected: JSON.stringify(expectedRows),
      predicted: JSON.stringify(items),
    };
  };
}
