/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskGraph } from "./TaskGraph";
import { GraphResult, PROPERTY_ARRAY } from "./TaskGraphRunner";

export interface WorkflowRunConfig {
  /** Optional service registry to use for this workflow run */
  readonly registry?: ServiceRegistry;
  /**
   * Resource scope for collecting heavyweight resource disposers during the
   * workflow run.
   *
   * If omitted, the underlying graph runner creates a private scope and
   * disposes it when the run finishes — automatic cleanup for casual callers.
   *
   * If provided, the caller owns the lifecycle; the runner never calls
   * `disposeAll`. Use this to share resources (e.g., a loaded AI model) across
   * multiple runs, then dispose at app shutdown.
   */
  readonly resourceScope?: ResourceScope;
  /**
   * Caller-owned cancellation for THIS run only.
   *
   * It is bridged onto the run's own controller, so aborting it cancels this
   * run and nothing else — the listener is removed when the run ends, so a
   * long-lived signal driving many runs accumulates nothing. That is the
   * difference from `Workflow.abort()`, which trips the single current-run
   * controller and therefore cancels whichever run started last — the wrong
   * granularity when several callers (e.g. two triggers) drive one workflow.
   */
  readonly signal?: AbortSignal | undefined;
}

export interface IWorkflow<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> {
  graph: TaskGraph;
  run(
    input?: Partial<Input>,
    config?: WorkflowRunConfig
  ): Promise<GraphResult<Output, typeof PROPERTY_ARRAY>>;
}
