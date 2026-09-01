/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import { registerBaseTasks } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";

export const registerTasks = () => {
  registerBaseTasks();
  registerCommonTasks({ fileSystemTasks: false });
  registerAiTasks();
};
