/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @internal
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
  private detachSignal?: () => void;

  constructor() {
    this.abortController = new AbortController();
  }

  /**
   * Bridges a caller-supplied per-run signal onto this run's controller, so the
   * run is cancelled by either source and the graph still sees ONE signal.
   *
   * A removable listener rather than `AbortSignal.any([own, caller])`: the
   * composite that `any` mints is retained by its sources until it is collected
   * (measurably ~1.7 KB per composite on Node 22 even after a forced GC), and a
   * long-lived caller signal — a trigger's, say — would collect one per fire.
   * The listener installed here is detached by {@link dispose} at run end, so
   * nothing accumulates however many runs a driver starts.
   */
  linkSignal(signal: AbortSignal): void {
    if (signal.aborted) {
      this.abortController.abort(signal.reason);
      return;
    }
    const onAbort = (): void => this.abortController.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    this.detachSignal = () => signal.removeEventListener("abort", onAbort);
  }

  /** Releases the streaming subscription and the caller-signal bridge. Idempotent. */
  dispose(): void {
    this.unsubStreaming?.();
    this.unsubStreaming = undefined;
    this.detachSignal?.();
    this.detachSignal = undefined;
  }
}
