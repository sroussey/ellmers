/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

export const DEFAULT_VECTOR_DIMENSION = 384;

export const VectorPrimaryKeyNames = ["id"] as const;
export const VectorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    embedding: { type: "string", format: "TypedArray:Float32:384" },
  },
  required: ["id", "embedding"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
