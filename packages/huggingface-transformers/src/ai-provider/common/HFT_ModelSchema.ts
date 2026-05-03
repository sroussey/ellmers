/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { HF_TRANSFORMERS_ONNX, PipelineUseCase, QuantizationDataType } from "./HFT_Constants";

export const HfTransformersOnnxModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: HF_TRANSFORMERS_ONNX,
      description: "Discriminator: ONNX runtime backend.",
    },
    provider_config: {
      type: "object",
      description: "ONNX runtime-specific options.",
      properties: {
        pipeline: {
          type: "string",
          enum: Object.values(PipelineUseCase),
          description: "Pipeline type for the ONNX model.",
          default: "text-generation",
        },
        model_path: {
          type: "string",
          description: "Filesystem path or URI for the ONNX model.",
        },
        revision: {
          type: "string",
          description: "Git revision (branch, tag, or commit hash) of the model repository.",
          default: "main",
        },
        dtype: {
          type: "string",
          enum: Object.values(QuantizationDataType),
          description: "Data type for the ONNX model.",
          default: "auto",
        },
        device: {
          type: "string",
          enum: ["cpu", "gpu", "webgpu", "wasm", "metal"],
          description: "High-level device selection.",
          default: "webgpu",
        },
        execution_providers: {
          type: "array",
          items: { type: "string" },
          description: "Raw ONNX Runtime execution provider identifiers.",
          "x-ui-hidden": true,
        },
        intra_op_num_threads: {
          type: "integer",
          minimum: 1,
        },
        inter_op_num_threads: {
          type: "integer",
          minimum: 1,
        },
        use_external_data_format: {
          type: "boolean",
          description: "Whether the model uses external data format.",
        },
        native_dimensions: {
          type: "integer",
          description: "The native dimensions of the model.",
        },
        pooling: {
          type: "string",
          enum: ["mean", "last_token", "cls"],
          description: "The pooling strategy to use for the model.",
          default: "mean",
        },
        normalize: {
          type: "boolean",
          description: "Whether the model uses normalization.",
          default: true,
        },
        language_style: {
          type: "string",
          description: "The language style of the model.",
        },
        seed: {
          type: "integer",
          description:
            "RNG seed passed to transformers.js sampling. Omit for time-based seeding; set for reproducible generation.",
          minimum: 0,
        },
        mrl: {
          type: "boolean",
          description: "Whether the model uses matryoshka.",
          default: false,
        },
      },
      required: ["model_path", "pipeline"],
      additionalProperties: false,
      if: {
        properties: {
          pipeline: {
            const: "feature-extraction",
          },
        },
      },
      then: {
        required: ["native_dimensions"],
      },
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const HfTransformersOnnxModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...HfTransformersOnnxModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...HfTransformersOnnxModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type HfTransformersOnnxModelRecord = FromSchema<typeof HfTransformersOnnxModelRecordSchema>;

export const HfTransformersOnnxModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...HfTransformersOnnxModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...HfTransformersOnnxModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type HfTransformersOnnxModelConfig = FromSchema<typeof HfTransformersOnnxModelConfigSchema>;
