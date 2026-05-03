/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
} from "@workglow/ai";
import { LLAMACPP_DEFAULT_MODELS_DIR } from "./LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getConfigKey, loadSdk, resolvedPaths } from "./LlamaCpp_Runtime";

export const LlamaCpp_Download: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, _signal) => {
  if (!model) throw new Error("Model config is required for DownloadModelTask.");

  const { createModelDownloader } = await loadSdk();
  const config = model.provider_config;
  const modelUri = config.model_url ?? config.model_path;
  const dirPath = config.models_dir ?? LLAMACPP_DEFAULT_MODELS_DIR;

  update_progress(0, "Creating model downloader");

  const downloader = await createModelDownloader({ modelUri, dirPath });

  const progressInterval = setInterval(() => {
    const total = downloader.totalSize;
    const downloaded = downloader.downloadedSize;
    if (total && total > 0 && downloaded !== undefined) {
      const pct = Math.min(99, Math.round((downloaded / total) * 100));
      update_progress(pct, "Downloading model", { file: modelUri, progress: pct });
    }
  }, 500);

  let modelPath: string;
  try {
    modelPath = await downloader.download();
  } finally {
    clearInterval(progressInterval);
  }

  resolvedPaths.set(getConfigKey(model), modelPath);

  update_progress(100, "Model downloaded", { file: modelUri, progress: 100 });

  return { model: input.model! };
};
