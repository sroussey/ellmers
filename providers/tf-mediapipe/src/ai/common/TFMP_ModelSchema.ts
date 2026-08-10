/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WithModelPricing } from "@workglow/ai/worker";
import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import type { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
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
        gpu: {
          type: "boolean",
          description:
            "Use GPU acceleration where the engine supports it: vision tasks use the GPU delegate; genai always requires WebGPU; text and audio tasks are CPU-only on web and ignore this option.",
          default: true,
        },
        max_tokens: {
          type: "integer",
          minimum: 1,
          description:
            "GenAI only: combined input+output token budget, fixed at model load. Must not exceed the converted bundle's KV-cache size.",
          default: 512,
        },
        top_k: {
          type: "integer",
          minimum: 1,
          description: "GenAI only: number of candidate tokens for top-k sampling.",
          default: 40,
        },
        temperature: {
          type: "number",
          minimum: 0,
          description:
            "GenAI only: sampling temperature, fixed at model load (the web SDK cannot change sampler options after load).",
          default: 0.8,
        },
        random_seed: {
          type: "integer",
          description: "GenAI only: random seed for sampling.",
        },
        chat_template: {
          type: "string",
          enum: ["gemma", "chatml", "none"],
          description:
            "GenAI only: how prompts and chat messages are rendered into the LLM's turn format. Use 'gemma' for Gemma-family bundles (default), 'chatml' for Qwen-family bundles, 'none' to pass text through verbatim.",
          default: "gemma",
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

export type TFMPModelRecord = WithModelPricing<FromSchema<typeof TFMPModelRecordSchema>>;

export const TFMPModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...TFMPModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...TFMPModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type TFMPModelConfig = WithModelPricing<FromSchema<typeof TFMPModelConfigSchema>>;
