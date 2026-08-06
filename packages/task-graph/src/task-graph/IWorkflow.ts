/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import type { TaskGraph } from "./TaskGraph";
import type { GraphResult, PROPERTY_ARRAY } from "./TaskGraphRunner";

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
