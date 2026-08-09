/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

export type RunUsagePrimaryKey = {
  run_id: string;
  sequence: number;
};

/**
 * One finished task execution's token accounting.
 *
 * Every counter is nullable because `undefined` means the provider reported
 * nothing, and collapsing that to `0` in the database would discard the same
 * distinction the in-memory type protects: a model that billed no cached tokens
 * and one that says nothing about caching are different facts.
 *
 * `sequence` disambiguates a task that executes more than once in a run — While,
 * Fallback and GraphAsTask reuse stable task ids across iterations.
 */
export const RunUsageSchema = {
  type: "object",
  properties: {
    run_id: { type: "string" },
    sequence: { type: "integer" },
    task_id: { type: "string" },
    task_type: { type: ["string", "null"] },
    model_id: { type: ["string", "null"] },
    input: { type: ["integer", "null"] },
    output: { type: ["integer", "null"] },
    cached: { type: ["integer", "null"] },
    cache_write: { type: ["integer", "null"] },
    reasoning: { type: ["integer", "null"] },
    total: { type: ["integer", "null"] },
    extra: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    cost: { type: ["number", "null"] },
    created_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const RunUsagePrimaryKeyNames = ["run_id", "sequence"] as const;
