/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/worker";

/**
 * A model configuration suitable for task/job inputs.
 *
 * @remarks
 * This is intentionally less strict than {@link ModelRecord} so jobs can carry only the
 * provider configuration required to execute, without requiring access to a model repository.
 */
export const ModelConfigSchema = {
  type: "object",
  properties: {
    model_id: { type: "string" },
    capabilities: { type: "array", items: { type: "string" }, "x-ui-editor": "multiselect" },
    title: { type: "string" },
    description: { type: "string", "x-ui-editor": "textarea" },
    provider: { type: "string" },
    provider_config: {
      type: "object",
      properties: {
        credential_key: { type: "string", format: "credential", "x-ui-hidden": true },
        native_dimensions: {
          type: "integer",
          description: "Native output vector dimensions for embedding models",
        },
        mrl: {
          type: "boolean",
          description: "Whether the model supports Matryoshka Representation Learning",
        },
      },
      additionalProperties: true,
      default: {},
    },
    metadata: { type: "object", default: {}, "x-ui-hidden": true },
    pricing: {
      type: "object",
      description: "Per-million-token rates. Declared by the caller; the library ships none.",
      properties: {
        currency: { type: "string", default: "USD" },
        input: { type: "number" },
        output: { type: "number" },
        cached: { type: "number" },
        cacheWrite: { type: "number" },
        cacheStoragePerHour: { type: "number" },
      },
      required: ["currency"],
      additionalProperties: false,
      "x-ui-hidden": true,
    },
  },
  required: ["provider", "provider_config"],
  format: "model",
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

/**
 * A fully-specified model record suitable for persistence in a repository.
 */
export const ModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
  },
  required: [
    "model_id",
    "capabilities",
    "provider",
    "title",
    "description",
    "provider_config",
    "metadata",
  ],
  format: "model",
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

/**
 * Per-million-token rates for one model, declared by the caller.
 *
 * Rates are per 1,000,000 tokens because that is how providers publish them, so
 * a rate card transcribes without arithmetic. There is deliberately no
 * `reasoning` rate: no provider charges one, and `output` already contains
 * reasoning tokens, so pricing them separately would double-charge.
 *
 * `cacheStoragePerHour` prices a provider-side cache billed by token-hours
 * (Gemini CachedContent) rather than by a one-off write.
 */
export interface ModelPricing {
  readonly currency: string;
  readonly input?: number;
  readonly output?: number;
  readonly cached?: number;
  readonly cacheWrite?: number;
  readonly cacheStoragePerHour?: number;
}

export type ModelConfig = {
  [x: string]: unknown;
  title?: string | undefined;
  description?: string | undefined;
  model_id?: string | undefined;
  capabilities?: string[] | undefined;
  metadata?: { [x: string]: unknown } | undefined;
  pricing?: ModelPricing | undefined;
  provider: string;
  provider_config: {
    [x: string]: unknown;
    credential_key?: string | undefined;
    native_dimensions?: number | undefined;
    mrl?: boolean | undefined;
  };
};
export type ModelRecord = {
  title: string;
  description: string;
  model_id: string;
  capabilities: string[];
  pricing?: ModelPricing | undefined;
  provider: string;
  provider_config: {
    [x: string]: unknown;
    credential_key?: string | undefined;
    native_dimensions?: number | undefined;
    mrl?: boolean | undefined;
  };
  metadata: { [x: string]: unknown };
};
export const ModelPrimaryKeyNames = ["model_id"] as const;
