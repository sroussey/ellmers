/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFnRegistration } from "@workglow/ai";
import {
  CACTUS_MODEL_DOWNLOAD,
  CACTUS_MODEL_DOWNLOAD_REMOVE,
  CACTUS_MODEL_INFO,
  CACTUS_MODEL_SEARCH,
  CACTUS_TOOL_USE,
} from "./Cactus_CapabilitySets";
import { Cactus_Download } from "./Cactus_Download.browser";
import { Cactus_DownloadRemove } from "./Cactus_DownloadRemove.browser";
import { Cactus_ModelInfo } from "./Cactus_ModelInfo.browser";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { Cactus_ModelSearch } from "./Cactus_ModelSearch";
import { Cactus_ToolCalling } from "./Cactus_ToolCalling.browser";

export {
  cactusConfigJson,
  cactusEngines,
  deleteCactusSession,
  disposeCactusResources,
  getOrLoadEngine,
  loadSdk,
  removeCachedAssets,
} from "./Cactus_Runtime.browser";

export const CACTUS_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  CactusModelConfig
>[] = [
  { serves: CACTUS_TOOL_USE, runFn: Cactus_ToolCalling },
  { serves: CACTUS_MODEL_DOWNLOAD, runFn: Cactus_Download },
  { serves: CACTUS_MODEL_DOWNLOAD_REMOVE, runFn: Cactus_DownloadRemove },
  { serves: CACTUS_MODEL_SEARCH, runFn: Cactus_ModelSearch },
  { serves: CACTUS_MODEL_INFO, runFn: Cactus_ModelInfo },
];

/** No preview-only tasks for Cactus today. */
export const CACTUS_PREVIEW_TASKS = {} as const;
