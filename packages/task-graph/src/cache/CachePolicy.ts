/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type CachePolicy = { kind: "deterministic" } | { kind: "private" } | { kind: "none" };

export const DEFAULT_CACHE_POLICY: CachePolicy = { kind: "deterministic" };

export function isPolicyCached(policy: CachePolicy): boolean {
  return policy.kind !== "none";
}

export function isPolicyPrivate(policy: CachePolicy): boolean {
  return policy.kind === "private";
}
