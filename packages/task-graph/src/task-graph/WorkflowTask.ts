/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphAsTask } from "../task/GraphAsTask";
import type { DataPorts } from "../task/TaskTypes";
import type { CompoundMergeStrategy } from "./TaskGraphRunner";
import { PROPERTY_ARRAY } from "./TaskGraphRunner";

/**
 * @internal
 * Workflow's private GraphAsTask subclass — the runtime task instance that
 * carries Workflow's compound-merge strategy. Constructed only by Workflow;
 * not part of the public surface.
 */
export class WorkflowTask<
  I extends DataPorts,
  O extends DataPorts,
> extends GraphAsTask<I, O> {
  public static override readonly type = "Workflow";
  public static override readonly compoundMerge = PROPERTY_ARRAY as CompoundMergeStrategy;
}
