/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-only surface for `@workglow/ai`.
 *
 * Symbols are reached through the package's own public entry, not by importing
 * the declaring modules directly. Each entry is a separate
 * `bun build --packages=external` bundle, so a relative import here would give
 * this bundle its own copy of the checkpoint registry — `clearCheckpoints()`
 * would clear a map nothing else reads, and `AiVisionTask` would be a different
 * class than the one subclasses extend, breaking every `instanceof`.
 */

import { _aiInternal } from "@workglow/ai";

/**
 * Base class for vision tasks. Exposed for tests that assert the task hierarchy;
 * not part of the supported API surface.
 */
export const AiVisionTask = _aiInternal.AiVisionTask;

/** Empties the checkpoint registry so cached prefixes do not leak across tests. */
export const clearCheckpoints: () => void = _aiInternal.clearCheckpointsForTesting;
