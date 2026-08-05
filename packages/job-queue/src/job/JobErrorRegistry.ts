/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { JobError } from "./JobError";

/**
 * Reconstructs a domain-specific {@link JobError} from a persisted error code
 * and message. Implementations should return a fully-typed `JobError` subclass
 * (e.g. `PermanentJobError`, `RetryableJobError`) with `code` set to
 * `errorCode` so callers can branch on it.
 *
 * The returned error MUST set `code` to `errorCode`. The reconstructor MUST
 * NOT throw — return a fallback `PermanentJobError` for unknown future codes
 * sharing the same prefix.
 */
export type ErrorCodeReconstructor = (errorCode: string, message: string) => JobError;

interface RegistryEntry {
  readonly prefix: string;
  readonly reconstructor: ErrorCodeReconstructor;
}

/**
 * Prefix → reconstructor table. Registered first wins on prefix conflicts
 * (a warning is emitted to make accidental shadowing visible). Idempotent
 * re-registration of the *same* function is a no-op.
 *
 * @internal Module-private; access via the exported `*ErrorCodeReconstructor*`
 * functions.
 */
const reconstructors: RegistryEntry[] = [];

/**
 * Register a reconstructor for a given error-code prefix. Tasks/providers
 * call this from their side-effect entry point so the {@link
 * JobQueueClient.buildErrorFromCode} round-trip preserves the original
 * `JobError` subclass (retryable vs permanent) across process boundaries.
 *
 * The same fn re-registered against the same prefix is a silent no-op.
 * A *different* fn registered against an already-claimed prefix logs a
 * warning and overwrites (last-writer-wins) so tests can override defaults
 * without leaking state — pair with {@link clearErrorCodeReconstructors}.
 */
export function registerErrorCodeReconstructor(
  prefix: string,
  reconstructor: ErrorCodeReconstructor
): void {
  if (!prefix) {
    throw new Error("registerErrorCodeReconstructor: prefix must be non-empty");
  }
  const existingIdx = reconstructors.findIndex((e) => e.prefix === prefix);
  if (existingIdx !== -1) {
    if (reconstructors[existingIdx]!.reconstructor === reconstructor) {
      return; // idempotent — same fn, same prefix
    }

    getLogger().warn("registerErrorCodeReconstructor: overwriting existing reconstructor", {
      prefix,
    });
    reconstructors[existingIdx] = { prefix, reconstructor };
    return;
  }
  reconstructors.push({ prefix, reconstructor });
}

/**
 * Look up a reconstructor for a given error code. Matches by `startsWith` —
 * first registered prefix that matches wins. Returns `undefined` when no
 * registered prefix matches.
 */
export function lookupErrorCodeReconstructor(
  errorCode: string
): ErrorCodeReconstructor | undefined {
  for (const entry of reconstructors) {
    if (errorCode.startsWith(entry.prefix)) {
      return entry.reconstructor;
    }
  }
  return undefined;
}

/**
 * Remove a single reconstructor by prefix. Returns `true` when an entry was
 * removed. Primarily for tests that register a reconstructor for assertion
 * and need to leave the global table clean.
 */
export function unregisterErrorCodeReconstructor(prefix: string): boolean {
  const idx = reconstructors.findIndex((e) => e.prefix === prefix);
  if (idx === -1) return false;
  reconstructors.splice(idx, 1);
  return true;
}

/**
 * Clear all registered reconstructors. TEST-ONLY: this permanently wipes the
 * global table for the current worker, including registrations made by
 * sibling test files via ESM module-load side effects (those can't re-run
 * because ESM caches modules). For tests that share a worker with code that
 * relies on side-effect registrations, prefer
 * {@link snapshotErrorCodeReconstructors} +
 * {@link restoreErrorCodeReconstructors}. Production code should not call this.
 */
export function clearErrorCodeReconstructors(): void {
  reconstructors.length = 0;
}

/**
 * Snapshot the current registry as a defensive copy. Pair with
 * {@link restoreErrorCodeReconstructors} in `beforeEach`/`afterEach` so test
 * mutations don't bleed across files in the same Vitest worker.
 */
export function snapshotErrorCodeReconstructors(): RegistryEntry[] {
  return reconstructors.map((e) => ({ prefix: e.prefix, reconstructor: e.reconstructor }));
}

/**
 * Replace the registry contents with the given snapshot (in order). Intended
 * to be used with the value returned from {@link snapshotErrorCodeReconstructors}.
 * Mutating the snapshot after passing it in does not affect the registry.
 */
export function restoreErrorCodeReconstructors(snapshot: readonly RegistryEntry[]): void {
  reconstructors.length = 0;
  for (const entry of snapshot) {
    reconstructors.push({ prefix: entry.prefix, reconstructor: entry.reconstructor });
  }
}
