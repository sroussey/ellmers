/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, TaskStatus, Usage } from "@workglow/task-graph";

// Common props for all node types
export interface NodeTaskProps {
  task: ITask;
  status: TaskStatus;
  progress: number;
  statusColor: string;
  isConnectable?: boolean;
  /** This node's cumulative token total for the current run. */
  usage?: Usage | undefined;
}
