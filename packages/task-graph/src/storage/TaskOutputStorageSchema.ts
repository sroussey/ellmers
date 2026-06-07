/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

export type TaskOutputPrimaryKey = {
  key: string;
  taskType: string;
};

export const TaskOutputSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    taskType: { type: "string" },
    value: { type: "string", contentEncoding: "blob" },
    createdAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const TaskOutputPrimaryKeyNames = ["key", "taskType"] as const;
