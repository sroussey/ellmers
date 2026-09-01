/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";
import type { Usage } from "@workglow/task-graph";
import { USAGE_OUTPUT_KEY, Workflow } from "@workglow/task-graph";
import type { ExtractedRow } from "../score/extraction";
import { fenceText } from "./prompt";
import { runWithStreamChunks } from "./streamSubscribe";
import type { ColumnOptions, DatasetContext, RowExecutor } from "./types";

const DEFAULT_INSTRUCTION = "Extract every entity mentioned in the text.";

/**
 * Assigning `obj["__proto__"] = ...` on a plain object mutates its prototype
 * instead of adding a key, so these names can neither be schema properties nor
 * scored fields.
 */
const UNSAFE_FIELDS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse a gold extraction column: parquet struct/list columns and
 * datasets-server JSON arrive as real arrays of objects; string columns hold
 * JSON. Anything else is a data error surfaced as a per-row failure.
 */
export function parseExpectedRows(value: unknown, column: string): ExtractedRow[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !Array.isArray(parsed) ||
    parsed.some((row) => row === null || typeof row !== "object" || Array.isArray(row))
  ) {
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
  if (UNSAFE_FIELDS.has(keyField)) {
    throw new Error(`--key-field "${keyField}" is not a usable field name`);
  }
  if (fields && fields.length > 0) {
    const safe = fields.filter((field) => !UNSAFE_FIELDS.has(field));
    return safe.includes(keyField) ? [...safe] : [keyField, ...safe];
  }
  const seen = new Set<string>([keyField]);
  for (const row of expectedRows) {
    for (const key of Object.keys(row)) if (!UNSAFE_FIELDS.has(key)) seen.add(key);
  }
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
    `"${keyField}" identifies the entity; use null when the text does not state a field.\n\n` +
    `Text:\n${fenceText(text)}\n\n` +
    `Respond with a JSON object of the form {"items": [{"${keyField}": "...", ...}, ...]}. ` +
    `Report each entity once; use only information from the text.`
  );
}

/**
 * Output schema for one extraction call: an `items` array of objects over
 * `fields`. Non-key fields are nullable because grammar-constrained local
 * backends emit every declared property regardless of `required` — null gives
 * them an honest value for fields the text never states.
 */
function buildItemsSchema(fields: readonly string[], keyField: string): Record<string, unknown> {
  const itemProperties: Record<string, unknown> = {};
  for (const field of fields) {
    itemProperties[field] = field === keyField ? { type: "string" } : { type: ["string", "null"] };
  }
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: itemProperties,
          required: [keyField],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
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
  // With an explicit --fields list the field set (and thus the schema) is the
  // same for every row; only the derived-from-gold-rows path is per-row.
  const explicitFields =
    options.fields && options.fields.length > 0
      ? resolveExtractionFields([], options.keyField, options.fields)
      : undefined;
  const explicitSchema = explicitFields
    ? buildItemsSchema(explicitFields, options.keyField)
    : undefined;

  return async (row, onStreamChunk, owner) => {
    const text = String(row[options.textColumn] ?? "");
    const expectedRows = parseExpectedRows(row[options.expectedColumn], options.expectedColumn);
    const fields =
      explicitFields ?? resolveExtractionFields(expectedRows, options.keyField, undefined);
    const outputSchema = explicitSchema ?? buildItemsSchema(fields, options.keyField);

    const workflow = new Workflow();
    workflow.structuredGeneration({
      model,
      prompt: buildExtractPrompt(text, instruction, options.keyField, fields),
      outputSchema,
      temperature: 0,
      maxTokens: 2048,
    });
    const output = await runWithStreamChunks<{
      object?: { items?: unknown };
      [USAGE_OUTPUT_KEY]?: Usage;
    }>(workflow, onStreamChunk, owner);
    const items = Array.isArray(output.object?.items)
      ? (output.object.items as ExtractedRow[])
      : [];
    return {
      expected: JSON.stringify(expectedRows),
      predicted: JSON.stringify(items),
      usage: output[USAGE_OUTPUT_KEY],
    };
  };
}
