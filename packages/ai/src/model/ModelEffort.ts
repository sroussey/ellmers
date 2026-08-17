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
  const value = (model as { effort_options?: unknown }).effort_options;
  if (!Array.isArray(value)) return undefined;
  return sanitizeEffortOptions(value) ?? [];
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

/**
 * Whether `model.effort` should be mapped onto a provider request. Native
 * `provider_config` knobs always win separately; this only gates the coarse dial.
 */
export function isModelEffortEnabled(
  model: object | undefined,
  policy: ModelEffortPolicy | undefined
): boolean {
  if (model === undefined) return false;
  const effort = (model as { effort?: unknown }).effort;
  if (!isModelEffort(effort)) return false;
  const enabled = enabledEffortsForModel(model, policy);
  return enabled === undefined || enabled.includes(effort);
}

export function effortPlaceholder(policy: ModelEffortPolicy | undefined): string {
  return policy?.default !== undefined ? `Default: ${policy.default}` : "Default";
}
