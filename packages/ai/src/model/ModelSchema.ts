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

export type ModelConfig = {
  [x: string]: unknown;
  title?: string | undefined;
  description?: string | undefined;
  model_id?: string | undefined;
  capabilities?: string[] | undefined;
  metadata?: { [x: string]: unknown } | undefined;
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
