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
    // Canonical TypedArray format with optional dimension suffix; matches the
    // TypedArrayString convention in @workglow/util/schema with a numeric suffix
    // that PostgresTabularStorage.getVectorDimensions parses to size pgvector
    // vector(N) columns.
    embedding: { type: "string", format: "TypedArray:Float32Array:384" },
  },
  required: ["id", "embedding"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

