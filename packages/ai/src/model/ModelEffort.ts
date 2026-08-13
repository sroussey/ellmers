/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coarse shared thinking / reasoning dial on {@link ModelConfig.effort}.
 * Native `provider_config` thinking knobs always win when set.
 */
export const MODEL_EFFORTS = ["none", "low", "medium", "high", "extra", "ultra"] as const;

export type ModelEffort = (typeof MODEL_EFFORTS)[number];

export function isModelEffort(value: unknown): value is ModelEffort {
  return typeof value === "string" && (MODEL_EFFORTS as readonly string[]).includes(value);
}

/**
 * Class-level effort support reported by a provider. `default` is display-only
 * (placeholder text); it is never persisted onto a model record.
 */
export interface ModelEffortPolicy {
  readonly supported: readonly ModelEffort[];
  readonly default: ModelEffort | undefined;
}

export function sanitizeEffortOptions(value: unknown): ModelEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isModelEffort);
}

export function readEffortOptions(model: object): ModelEffort[] | undefined {
  if (!("effort_options" in model)) return undefined;
  return sanitizeEffortOptions((model as { effort_options?: unknown }).effort_options) ?? [];
}

export function stampEffortOptions<T extends object>(
  record: T,
  policy: ModelEffortPolicy | undefined
): T & { effort_options?: ModelEffort[] } {
  if (policy === undefined) return record;
  return { ...record, effort_options: [...policy.supported] };
}

export function enabledEffortsForModel(
  model: object,
  policy: ModelEffortPolicy | undefined
): readonly ModelEffort[] | undefined {
  const pinned = readEffortOptions(model);
  if (pinned !== undefined) return pinned;
  return policy?.supported;
}

export function effortPlaceholder(policy: ModelEffortPolicy | undefined): string {
  return policy?.default !== undefined ? `Default: ${policy.default}` : "Default";
}
