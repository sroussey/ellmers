/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type { StreamMode } from "../task/StreamTypes";

/**
 * Brand value for {@link CacheRef}. A literal string (not a Symbol) so the brand
 * survives JSON serialization across queue rows / IPC boundaries — a Symbol-based
 * brand would be erased by `JSON.stringify` and the resulting object would no
 * longer be identifiable as a cache reference on the receiving side.
 */
export const CACHE_REF_KIND = "task-graph/CacheRef" as const;

/**
 * A reference to bytes that live in the configured cache backing rather than
 * inline in a task `Output`. Emitted by `TaskRunner` for streaming output ports
 * whose committed size meets the `IRunConfig.referenceThresholdBytes` and
 * whose cache backing implements `saveOutputStreamPort`.
 *
 * `$ref` is opaque to consumers: only the cache backing knows how to translate
 * it back into bytes. `size` and `mime` are best-effort hints populated when
 * known at finish time; absent values do not imply unknown failure.
 *
 * The `kind` brand discriminates a cache ref from other `{$ref: string}`
 * shapes (e.g. JSON-Schema references) so the resolver never walks an
 * untrusted `$ref` string into the cache. The brand is a literal so it survives
 * JSON round-trip across queue boundaries.
 *
 * Resolution is best-effort: the cache backing's TTL is the lifetime contract,
 * and `resolveOutputRef` returns `undefined` when the underlying entry has
 * been evicted.
 */
export interface ICacheRef {
  readonly kind: typeof CACHE_REF_KIND;
  readonly $ref: string;
  /**
   * Which output port produced these bytes. Optional because a backing is free
   * to leave it off (a `$ref` alone resolves); when present, it lets a row
   * carry more than one ref unambiguously and the resolver pick the right one
   * without a schema lookup.
   */
  readonly port?: string;
  /**
   * Stream mode of the persisted bytes, so a reader knows the codec to replay
   * (`binary` raw bytes, `append` text, `object` NDJSON deltas). A ref with no
   * `mode` defaults to binary handling.
   */
  readonly mode?: StreamMode;
  readonly size?: number;
  readonly mime?: string;
}

export type CacheRef = ICacheRef;

/**
 * Narrow an unknown value to {@link CacheRef}. Discriminates on the literal
 * {@link CACHE_REF_KIND} brand AND a string `$ref`; shape-only `{$ref: string}`
 * objects (JSON-Schema refs, user metadata) do NOT match.
 */
export function isCacheRef(value: unknown): value is CacheRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly kind?: unknown; readonly $ref?: unknown };
  return candidate.kind === CACHE_REF_KIND && typeof candidate.$ref === "string";
}

/**
 * Construct a branded {@link CacheRef}. Cache backings MUST use this helper (or
 * spread `{kind: CACHE_REF_KIND, ...}` themselves) so the resulting ref carries
 * the brand. Helpers in {@link CacheCoordinator} defensively re-wrap a backing
 * whose writer returns an unbranded `{$ref}` shape.
 */
export function makeCacheRef(raw: {
  readonly $ref: string;
  readonly port?: string;
  readonly mode?: StreamMode;
  readonly size?: number;
  readonly mime?: string;
}): CacheRef {
  return {
    kind: CACHE_REF_KIND,
    $ref: raw.$ref,
    ...(raw.port !== undefined && { port: raw.port }),
    ...(raw.mode !== undefined && { mode: raw.mode }),
    ...(raw.size !== undefined && { size: raw.size }),
    ...(raw.mime !== undefined && { mime: raw.mime }),
  };
}

/**
 * Collapse a string onto the blob-name alphabet `[\w.-]` (every other
 * character becomes `-`). Blob/ref tokens minted from `taskType` / `port`
 * pass through this so a name is always a single filesystem/URI-safe segment.
 * Lossy: distinct inputs may collide (`My@Task` and `My/Task` both sanitize
 * to `My-Task`), so uniqueness always comes from the fingerprint + UUID
 * portions of a token, never from the sanitized prefix.
 */
export function sanitize(s: string): string {
  return s.replace(/[^\w.-]/g, "-");
}

/**
 * Mint the storage token for one streamed write:
 * `<sanitize(taskType)>_<fingerprint>[_<sanitize(port)>]_<uuid>`. The prefix
 * keeps tokens greppable and prefix-deletable per task type; the per-write
 * UUID suffix makes every token unique, so two concurrent writers of the same
 * `(taskType, inputs[, port])` land at distinct blobs and cannot race on one.
 */
export function mintRefKey(taskType: string, fingerprint: string, port?: string): string {
  const portPart = port === undefined ? "" : `_${sanitize(port)}`;
  return `${sanitize(taskType)}_${fingerprint}${portPart}_${uuid4()}`;
}

/**
 * Build the `$ref` matcher for a blob scheme. The captured token is a single
 * `[\w.-]+` segment (the {@link mintRefKey} alphabet), so anything else —
 * foreign `$ref` schemes, in-flight `.tmp` sidecars, and traversal-shaped
 * refs (`../../etc/passwd`) — never resolves to a stored blob: `/` cannot
 * appear inside the token, which rules out path traversal through a crafted
 * ref. `pathPrefix` (e.g. `blobs/`) sits between `<scheme>://` and the token;
 * `suffix` (e.g. `.bin`) must terminate the token and is captured with it.
 */
export function makeRefPattern(
  scheme: string,
  opts: { readonly pathPrefix?: string; readonly suffix?: string } = {}
): RegExp {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathPrefix = opts.pathPrefix === undefined ? "" : escape(opts.pathPrefix);
  const suffix = opts.suffix === undefined ? "" : escape(opts.suffix);
  return new RegExp(`^${escape(scheme)}://${pathPrefix}([\\w.-]+${suffix})$`);
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
