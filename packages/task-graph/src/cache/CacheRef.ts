/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A reference to bytes that live in the configured cache backing rather than
 * inline in a task `Output`. Emitted by `TaskRunner` for binary output ports
 * whose committed size meets the `IRunConfig.referenceThresholdBytes` and
 * whose cache backing implements `saveOutputStream`.
 *
 * `$ref` is opaque to consumers: only the cache backing knows how to translate
 * it back into bytes. `size` and `mime` are best-effort hints populated when
 * known at finish time; absent values do not imply unknown failure.
 *
 * Resolution is best-effort: the cache backing's TTL is the lifetime contract,
 * and `resolveOutputRef` returns `undefined` when the underlying entry has
 * been evicted.
 */
export type CacheRef = {
  readonly $ref: string;
  readonly size?: number;
  readonly mime?: string;
};

/**
 * Narrow an unknown value to {@link CacheRef}. The discriminator is a `$ref`
 * property of type `string`; other fields are optional and not inspected.
 */
export function isCacheRef(value: unknown): value is CacheRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly $ref?: unknown };
  return typeof candidate.$ref === "string";
}

/**
 * Default threshold (in bytes) at which a binary output port becomes a
 * {@link CacheRef} instead of being inlined in `Output`. Below this size, the
 * runner inlines the bytes; at or above, it emits a reference.
 *
 * `0` is a sentinel meaning "always emit a reference" and is honored by the
 * runtime path (a callsite that wants to force refs sets `0` explicitly via
 * `IRunConfig.referenceThresholdBytes`).
 */
export const REFERENCE_THRESHOLD_BYTES_DEFAULT = 65_536;

/**
 * Resolve the effective reference threshold for a run, falling back to
 * {@link REFERENCE_THRESHOLD_BYTES_DEFAULT} when unset. A negative value is
 * treated as the default (negative thresholds are nonsensical).
 */
export function resolveReferenceThreshold(threshold: number | undefined): number {
  if (threshold === undefined) return REFERENCE_THRESHOLD_BYTES_DEFAULT;
  if (threshold < 0) return REFERENCE_THRESHOLD_BYTES_DEFAULT;
  return threshold;
}
