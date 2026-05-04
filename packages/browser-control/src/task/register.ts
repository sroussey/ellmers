/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { BrowserSessionTask } from "./tasks/BrowserSessionTask";
import { BrowserCloseTask } from "./tasks/BrowserCloseTask";
import { BrowserNavigateTask } from "./tasks/BrowserNavigateTask";
import { BrowserBackTask } from "./tasks/BrowserBackTask";
import { BrowserForwardTask } from "./tasks/BrowserForwardTask";
import { BrowserReloadTask } from "./tasks/BrowserReloadTask";
import { BrowserSnapshotTask } from "./tasks/BrowserSnapshotTask";
import { BrowserScreenshotTask } from "./tasks/BrowserScreenshotTask";
import { BrowserClickTask } from "./tasks/BrowserClickTask";
import { BrowserFillTask } from "./tasks/BrowserFillTask";
import { BrowserSelectTask } from "./tasks/BrowserSelectTask";
import { BrowserHoverTask } from "./tasks/BrowserHoverTask";
import { BrowserExtractTextTask } from "./tasks/BrowserExtractTextTask";
import { BrowserExtractHtmlTask } from "./tasks/BrowserExtractHtmlTask";
import { BrowserAttributeTask } from "./tasks/BrowserAttributeTask";
import { BrowserQuerySelectorTask } from "./tasks/BrowserQuerySelectorTask";
import { BrowserEvaluateTask } from "./tasks/BrowserEvaluateTask";
import { BrowserPressKeyTask } from "./tasks/BrowserPressKeyTask";
import { BrowserTypeTask } from "./tasks/BrowserTypeTask";
import { BrowserScrollTask } from "./tasks/BrowserScrollTask";
import { BrowserUploadTask } from "./tasks/BrowserUploadTask";
import { BrowserWaitTask } from "./tasks/BrowserWaitTask";
import { BrowserNewTabTask } from "./tasks/BrowserNewTabTask";
import { BrowserSwitchTabTask } from "./tasks/BrowserSwitchTabTask";
import { BrowserCloseTabTask } from "./tasks/BrowserCloseTabTask";
import { BrowserLoginTask } from "./tasks/BrowserLoginTask";

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
