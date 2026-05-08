/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { TENSORFLOW_MEDIAPIPE, TextPipelineTask } from "../common/TFMP_Constants";

export const TFMPModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: TENSORFLOW_MEDIAPIPE,
      description: "Discriminator: TensorFlow MediaPipe backend.",
    },
    provider_config: {
      type: "object",
      description: "TensorFlow MediaPipe-specific options.",
      properties: {
        model_path: {
          type: "string",
          description: "Filesystem path or URI for the ONNX model.",
        },
        task_engine: {
          type: "string",
          enum: ["text", "audio", "vision", "genai"],
          description: "Task engine for the MediaPipe model.",
        },
        pipeline: {
          type: "string",
          enum: Object.values(TextPipelineTask),
          description: "Pipeline task type for the MediaPipe model.",
        },
      },
      required: ["model_path", "task_engine", "pipeline"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const TFMPModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...TFMPModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...TFMPModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type TFMPModelRecord = FromSchema<typeof TFMPModelRecordSchema>;

export const TFMPModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...TFMPModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...TFMPModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type TFMPModelConfig = FromSchema<typeof TFMPModelConfigSchema>;
