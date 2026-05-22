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
import { CactusIntegrityError } from "./Cactus_Integrity";
import { assetSpecsOf, getCactusCatalogEntry } from "./Cactus_ModelCatalog";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { fetchAssetBytes, markModelCached } from "./Cactus_Runtime";

export const Cactus_Download: AiProviderRunFn<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  CactusModelConfig
> = async (input, model, _signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadTask.");
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);

  const specs = assetSpecsOf(entry);
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    emit({
      type: "phase",
      message: `Downloading ${spec.filename}`,
      progress: Math.round(((i + 0.5) / specs.length) * 99),
    });
    try {
      await fetchAssetBytes(model, spec);
    } catch (err) {
      // Surface whatever the integrity layer phrased — it knows whether the
      // mismatch was a SHA-256 digest or a byte-length pre-check, and the
      // error message is already shaped correctly for both.
      emit({
        type: "phase",
        message: err instanceof CactusIntegrityError ? err.message : String(err),
      });
      throw err;
    }
  }
  markModelCached(model_id);
  emit({ type: "finish", data: { model: input.model! } });
};
