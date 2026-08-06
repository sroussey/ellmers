/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FromSchema } from "../json-schema/FromSchema";
import type { JsonSchema } from "../json-schema/JsonSchema";
import type { TypedArraySchemaOptions } from "./TypedArray";
import { TypedArraySchema } from "./TypedArray";

export const TensorType = {
  FLOAT16: "float16",
  FLOAT32: "float32",
  FLOAT64: "float64",
  INT8: "int8",
  UINT8: "uint8",
  INT16: "int16",
  UINT16: "uint16",
} as const;

export type TensorType = (typeof TensorType)[keyof typeof TensorType];

/**
 * Tensor schema for representing tensors as arrays of numbers
 * @param annotations - Additional annotations for the schema
 * @returns The tensor schema
 */
export const TensorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: Object.values(TensorType),
        title: "Type",
        description: "The type of the tensor",
      },
      data: TypedArraySchema({
        title: "Data",
        description: "The data of the tensor",
      }),
      shape: {
        type: "array",
        items: { type: "number" },
        title: "Shape",
        description: "The shape of the tensor (dimensions)",
        minItems: 1,
        default: [1],
      },
      normalized: {
        type: "boolean",
        title: "Normalized",
        description: "Whether the tensor data is normalized",
        default: false,
      },
    },
    required: ["data"],
    additionalProperties: false,
    ...annotations,
  }) as const satisfies JsonSchema;

export type Tensor = FromSchema<ReturnType<typeof TensorSchema>, TypedArraySchemaOptions>;
