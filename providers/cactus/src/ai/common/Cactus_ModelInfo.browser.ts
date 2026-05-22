/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { getCactusCatalogEntry } from "./Cactus_ModelCatalog";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { getCactusModelCacheInfo, isModelCached, isModelLoaded } from "./Cactus_Runtime.browser";

export const Cactus_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  CactusModelConfig
> = async (input, model, signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelInfoTask.");
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);

  const is_loaded = isModelLoaded(model_id);
  const cacheInfo = await getCactusModelCacheInfo(model, entry, input.detail, signal);
  const is_cached = is_loaded || isModelCached(model_id) || cacheInfo.allCached;

  emit({
    type: "finish",
    data: {
      model: input.model,
      is_local: true,
      is_remote: false,
      supports_browser: true,
      supports_node: true,
      is_cached,
      is_loaded,
      file_sizes: cacheInfo.file_sizes,
    },
  });
};
