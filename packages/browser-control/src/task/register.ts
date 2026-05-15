/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { BrowserAttributeTask } from "./tasks/BrowserAttributeTask";
import { BrowserBackTask } from "./tasks/BrowserBackTask";
import { BrowserClickTask } from "./tasks/BrowserClickTask";
import { BrowserCloseTabTask } from "./tasks/BrowserCloseTabTask";
import { BrowserCloseTask } from "./tasks/BrowserCloseTask";
import { BrowserEvaluateTask } from "./tasks/BrowserEvaluateTask";
import { BrowserExtractHtmlTask } from "./tasks/BrowserExtractHtmlTask";
import { BrowserExtractTextTask } from "./tasks/BrowserExtractTextTask";
import { BrowserFillTask } from "./tasks/BrowserFillTask";
import { BrowserForwardTask } from "./tasks/BrowserForwardTask";
import { BrowserHoverTask } from "./tasks/BrowserHoverTask";
import { BrowserLoginTask } from "./tasks/BrowserLoginTask";
import { BrowserNavigateTask } from "./tasks/BrowserNavigateTask";
import { BrowserNewTabTask } from "./tasks/BrowserNewTabTask";
import { BrowserPressKeyTask } from "./tasks/BrowserPressKeyTask";
import { BrowserQuerySelectorTask } from "./tasks/BrowserQuerySelectorTask";
import { BrowserReloadTask } from "./tasks/BrowserReloadTask";
import { BrowserScreenshotTask } from "./tasks/BrowserScreenshotTask";
import { BrowserScrollTask } from "./tasks/BrowserScrollTask";
import { BrowserSelectTask } from "./tasks/BrowserSelectTask";
import { BrowserSessionTask } from "./tasks/BrowserSessionTask";
import { BrowserSnapshotTask } from "./tasks/BrowserSnapshotTask";
import { BrowserSwitchTabTask } from "./tasks/BrowserSwitchTabTask";
import { BrowserTypeTask } from "./tasks/BrowserTypeTask";
import { BrowserUploadTask } from "./tasks/BrowserUploadTask";
import { BrowserWaitTask } from "./tasks/BrowserWaitTask";

export const browserTasks = [
  BrowserSessionTask,
  BrowserCloseTask,
  BrowserNavigateTask,
  BrowserBackTask,
  BrowserForwardTask,
  BrowserReloadTask,
  BrowserSnapshotTask,
  BrowserScreenshotTask,
  BrowserClickTask,
  BrowserFillTask,
  BrowserSelectTask,
  BrowserHoverTask,
  BrowserExtractTextTask,
  BrowserExtractHtmlTask,
  BrowserAttributeTask,
  BrowserQuerySelectorTask,
  BrowserEvaluateTask,
  BrowserPressKeyTask,
  BrowserTypeTask,
  BrowserScrollTask,
  BrowserUploadTask,
  BrowserWaitTask,
  BrowserNewTabTask,
  BrowserSwitchTabTask,
  BrowserCloseTabTask,
  BrowserLoginTask,
] as const;

export function registerBrowserTasks(): void {
  browserTasks.forEach((task) => TaskRegistry.registerTask(task));
}
