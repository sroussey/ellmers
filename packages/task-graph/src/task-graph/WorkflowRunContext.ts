/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-run mutable state for a single Workflow.run() invocation. Built at the
 * top of run(), discarded in the run's finally clause. Mirrors RunContext on
 * the TaskGraphRunner side: a small value object so per-run resources have a
 * single owner with a clear disposal point, and so suspend/resume work in the
 * future has an obvious place to grow.
 *
 * Single-field on the facade (last-run-wins for abort), matching the pre-
 * existing abort semantics — concurrent run() calls overwrite the field, and
 * abort() only targets the most-recently-started run. The streaming unsub
 * lives on the context (not the bridge) so concurrent runs do not clobber
 * each other's streaming subscriptions.
 */
export class WorkflowRunContext {
  readonly abortController: AbortController;
  unsubStreaming?: () => void;

  constructor() {
    this.abortController = new AbortController();
  }

  /** Releases the streaming subscription if one is held. Idempotent. */
  dispose(): void {
    this.unsubStreaming?.();
    this.unsubStreaming = undefined;
  }
}
