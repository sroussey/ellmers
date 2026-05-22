/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
} from "@workglow/ai";
import { getCactusCatalogEntry } from "./Cactus_ModelCatalog";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { fetchAssetBytes, markModelCached } from "./Cactus_Runtime.browser";

export const Cactus_Download: AiProviderRunFn<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  CactusModelConfig
> = async (input, model, _signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadTask.");
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);

  const assets = [entry.assets.weights, entry.assets.vocab, entry.assets.config];
  for (let i = 0; i < assets.length; i++) {
    emit({
      type: "phase",
      message: `Downloading ${assets[i]}`,
      progress: Math.round(((i + 0.5) / assets.length) * 99),
    });
    await fetchAssetBytes(model, assets[i]);
  }
  markModelCached(model_id);
  emit({ type: "finish", data: { model: input.model! } });
};
