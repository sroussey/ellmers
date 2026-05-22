/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelDownloadRemoveTaskRunInput,
  ModelDownloadRemoveTaskRunOutput,
} from "@workglow/ai";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { removeCachedAssets } from "./Cactus_Runtime.browser";

export const Cactus_DownloadRemove: AiProviderRunFn<
  ModelDownloadRemoveTaskRunInput,
  ModelDownloadRemoveTaskRunOutput,
  CactusModelConfig
> = async (input, model, _signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadRemoveTask.");
  await removeCachedAssets(model);
  emit({ type: "finish", data: { model: input.model } });
};
