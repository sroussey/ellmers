/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry, ResourceScope } from "@workglow/util";
import { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskGraph } from "./TaskGraph";
import { GraphResult, PROPERTY_ARRAY } from "./TaskGraphRunner";

export interface WorkflowRunConfig {
  /** Optional service registry to use for this workflow run */
  readonly registry?: ServiceRegistry;
  /** Resource scope for collecting heavyweight resource disposers. */
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
