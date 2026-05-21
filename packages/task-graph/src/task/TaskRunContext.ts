/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISpan } from "@workglow/util";
import type { TaskTimeoutError } from "./TaskError";

/**
 * @internal
 * Per-run mutable state for a single TaskRunner.run() / runPreview() invocation.
 * Built by TaskRunner.handleStart, discarded by handleComplete / handleError / handleAbort.
 *
 * Long-lived state (task, registry, resourceScope, outputCache default, accumulateLeafOutputs)
 * stays on the facade. TaskRunContext only holds state created at run start and torn down
 * at run end.
 */
export class TaskRunContext {
  readonly abortController: AbortController;

  shouldAccumulate: boolean = true;
  telemetrySpan?: ISpan;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  pendingTimeoutError?: TaskTimeoutError;

  /**
   * Set by the first terminal handler (handleAbort / handleComplete / handleError /
   * handleDisable) that runs for this ctx. Lets handlers be idempotent per-ctx
   * without leaning on `task.status`, which is externally observable and can be
   * mutated by adjacent runs.
   */
  terminated: boolean = false;

  // Removes the parentSignal abort listener; set in the constructor when
  // parentSignal is provided. Idempotent dispose().
  private parentSignalCleanup?: () => void;

  constructor(parentSignal?: AbortSignal) {
    this.abortController = new AbortController();
    if (parentSignal) {
      // Listen first, then check — addEventListener on an already-aborted signal
      // does not fire, so checking .aborted after ensures we never miss an abort.
      const onParentAbort = () => this.abortController.abort();
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
      this.parentSignalCleanup = () => parentSignal.removeEventListener("abort", onParentAbort);
      if (parentSignal.aborted) {
        this.parentSignalCleanup();
        this.parentSignalCleanup = undefined;
        this.abortController.abort();
      }
    }
  }

  /**
   * Releases external listeners (parentSignal abort handler). Idempotent.
   * Called by terminal handlers (handleComplete / handleError / handleAbort)
   * so a parent abort fired after this run completes does not re-trigger our
   * abort path and emit a duplicate terminal event.
   */
  dispose(): void {
    this.parentSignalCleanup?.();
    this.parentSignalCleanup = undefined;
  }
}
