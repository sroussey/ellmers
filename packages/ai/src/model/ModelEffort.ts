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
