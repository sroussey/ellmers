/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

export type RunPrivateTaskOutputPrimaryKey = {
  runId: string;
  key: string;
  taskType: string;
};

/**
 * Storage shape for the run-private output cache. Distinct from
 * {@link TaskOutputSchema}: it carries a first-class `runId` column and a
 * runId-leading primary key. That makes run-scoped cleanup (`clearRun`, the
 * janitor sweep) an indexed delete rather than a full-table scan, and keeps two
 * runs that execute the same task with identical inputs from colliding on
 * `(key, taskType)`.
 */
export const RunPrivateTaskOutputSchema = {
  type: "object",
  properties: {
    runId: { type: "string" },
    key: { type: "string" },
    taskType: { type: "string" },
    value: { type: "string", contentEncoding: "blob" },
    createdAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const RunPrivateTaskOutputPrimaryKeyNames = ["runId", "key", "taskType"] as const;
