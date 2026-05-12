/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "vitest";

// Removed in run-fn Promise+emit refactor: storage-backed JobQueue path was dropped
// from QueuedExecutionStrategy (commit 88748d49); AI dispatch is limiter-direct only.
// The two "Should use the pre-registered queue" cases (InMemoryJobQueue + SqliteJobQueue)
// no longer map to a meaningful invariant and have been deleted. The describe block is
// kept as a placeholder so a future limiter-direct AI dispatch test can land here.
describe("HFTransformersBinding", () => {
  it.skip("pre-registered storage-backed JobQueue path removed in Promise+emit refactor", () => {
    // intentionally empty
  });
});
