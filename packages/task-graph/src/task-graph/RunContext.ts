/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISpan } from "@workglow/util";
import { uuid4 } from "@workglow/util";
import type { IEntitlementEnforcer } from "../task/EntitlementEnforcer";
import type { TaskError, TaskGraphTimeoutError } from "../task/TaskError";
import type { TaskOutput } from "../task/TaskTypes";

/**
 * @internal
 * Per-run mutable state for a single TaskGraphRunner.runGraph() invocation.
 * Built by TaskGraphRunner.handleStart(), discarded by handleComplete/Error/Abort.
 *
 * All long-lived state (graph, schedulers, registry, resourceScope, outputCache,
 * accumulateLeafOutputs) stays on the facade. RunContext only holds state that is
 * created at the start of a run and torn down when the run terminates.
 */
export class RunContext {
  readonly runId: string;
  readonly abortController: AbortController;
  readonly inProgressTasks: Map<unknown, Promise<TaskOutput>> = new Map();
  readonly inProgressFunctions: Map<unknown, Promise<void>> = new Map();
  readonly failedTaskErrors: Map<unknown, TaskError> = new Map();

  telemetrySpan?: ISpan;
  graphTimeoutTimer?: ReturnType<typeof setTimeout>;
  pendingGraphTimeoutError?: TaskGraphTimeoutError;
  activeEnforcer?: IEntitlementEnforcer;

  // Removes the parentSignal abort listener, if one was registered. Set in the
  // constructor when parentSignal is provided; called from dispose().
  private parentSignalCleanup?: () => void;

  constructor(parentSignal?: AbortSignal, runId?: string) {
    // Derive from the caller-supplied runId when present so the same identifier
    // flows through to per-task runnerId (and thus queued-job jobRunId). This
    // lets a caller holding the graph's runId reliably target the run's queued
    // jobs via the queue's runId-keyed operations (e.g. abortJobRun(runId)).
    // Falls back to a fresh uuid when no runId was provided.
    this.runId = runId ?? uuid4();
    this.abortController = new AbortController();
    if (parentSignal) {
      // Listen first, then check — addEventListener on an already-aborted signal
      // does not fire, so checking .aborted after ensures we never miss an abort.
      // Pattern preserved from commit 4e50c99e.
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
   * Called by terminal handlers (handleComplete/Error/Abort) so a parent abort
   * fired after this run completes does not re-trigger our abort path and emit
   * a duplicate terminal event.
   */
  dispose(): void {
    this.parentSignalCleanup?.();
    this.parentSignalCleanup = undefined;
  }
}
