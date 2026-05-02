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

  constructor(parentSignal?: AbortSignal) {
    this.runId = uuid4();
    this.abortController = new AbortController();
    if (parentSignal) {
      // Listen first, then check — addEventListener on an already-aborted signal
      // does not fire, so checking .aborted after ensures we never miss an abort.
      // Pattern preserved from commit 4e50c99e.
      const onParentAbort = () => this.abortController.abort();
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
      if (parentSignal.aborted) {
        parentSignal.removeEventListener("abort", onParentAbort);
        this.abortController.abort();
      }
    }
  }
}
