/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/worker";
import type { ModelEffort } from "./ModelEffort";

export {
  EFFORT_POLICY_ALL,
  EFFORT_POLICY_NONE,
  effortPlaceholder,
  enabledEffortsForModel,
  isModelEffort,
  makeEffortPolicy,
  MODEL_EFFORTS,
  readEffortOptions,
  readModelName,
  resolveEnabledEffort,
  sanitizeEffortOptions,
  stampEffortOptions,
} from "./ModelEffort";
export type {
  EffortIdMatcher,
  EffortPolicyRule,
  EffortPolicySpec,
  ModelEffort,
  ModelEffortPolicy,
  ModelEffortPolicyFn,
} from "./ModelEffort";

import {
  FREE_LOCAL_PRICING,
  ModelPricingSchema,
  type ModelPricing,
  type ModelPricingBase,
  type ModelTimingTier,
  type ModelUsageTier,
} from "./ModelPricing";
export { FREE_LOCAL_PRICING, ModelPricingSchema };
export type { ModelPricing, ModelPricingBase, ModelTimingTier, ModelUsageTier };

/**
 * {@link ModelPricingSchema} under a deliberately shallow type.
 *
 * The runtime value is the rate-card schema itself, so validation and the model
 * form still see every rate property. Only the static type is widened, because
 * every provider derives its model type with `FromSchema` over a spread of
 * these properties and then discards the derived `pricing` again through
 * {@link WithModelPricing}. Letting `FromSchema` walk the full card — nested
 * rate objects, an `anyOf`, two tier arrays — built a type nobody reads, at
 * ~45k instantiations per provider across ~19 of them. This is a widening, not
 * a cast: an annotation TypeScript checks, so it cannot drift from the schema.
 *
 * Read the schema through `ModelPricingSchema` when you want its shape; the
 * property here is the same object.
 */
const PricingProperty: { readonly type: "object" } = ModelPricingSchema;

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
    effort: {
      type: "string",
      enum: ["none", "low", "medium", "high", "extra", "ultra"],
      description:
        "Coarse thinking/reasoning dial. Native provider_config thinking knobs always win when set.",
    },
    effort_options: {
      type: "array",
      items: { type: "string", enum: ["none", "low", "medium", "high", "extra", "ultra"] },
      description:
        "Enabled coarse effort levels for this model. When present (including empty), overrides provider.effortPolicy for UI.",
    },
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
    pricing: PricingProperty,
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
 * Rebinds a `pricing` property inferred from `FromSchema` to the hand-written
 * {@link ModelPricing}.
 *
 * The `pricing` sub-schema's `required` list names only `currency` (every
 * rate is caller-declared and may be unreported), so `FromSchema` derives the
 * other rates as optional keys -- faithful to the JSON schema, where "not
 * required" means the key may be absent. A required key of `number |
 * undefined` never accepts an optional key, so a bare provider config/record
 * type built by spreading `ModelConfigSchema`/`ModelRecordSchema` properties
 * can't structurally satisfy {@link ModelConfig} / {@link ModelRecord}'s
 * `pricing` field. Provider schema modules apply this to their derived type
 * instead.
 */
export type WithModelPricing<T> = Omit<T, "pricing"> & {
  readonly pricing?: ModelPricing | undefined;
};

export type ModelConfig = {
  [x: string]: unknown;
  title?: string | undefined;
  description?: string | undefined;
  model_id?: string | undefined;
  capabilities?: string[] | undefined;
  metadata?: { [x: string]: unknown } | undefined;
  pricing?: ModelPricing | undefined;
  effort?: ModelEffort | undefined;
  effort_options?: ModelEffort[] | undefined;
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
  effort?: ModelEffort | undefined;
  effort_options?: ModelEffort[] | undefined;
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
