/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
} from "@workglow/ai";
import { LLAMACPP_DEFAULT_MODELS_DIR } from "./LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getConfigKey, loadSdk, resolvedPaths } from "./LlamaCpp_Runtime";

export const LlamaCpp_Download: AiProviderRunFn<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, _signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadTask.");

  const { createModelDownloader } = await loadSdk();
  const config = model.provider_config;
  const modelUri = config.model_url ?? config.model_path;
  const dirPath = config.models_dir ?? LLAMACPP_DEFAULT_MODELS_DIR;

  const downloader = await createModelDownloader({ modelUri, dirPath });

  const downloadPromise = downloader.download();
  let modelPath: string | undefined;
  let downloadError: unknown;
  downloadPromise.then(
    (p) => {
      modelPath = p;
    },
    (e) => {
      downloadError = e;
    }
  );

  // Poll progress while download is in flight, emitting phase events.
  let settled = false;
  downloadPromise.finally(() => {
    settled = true;
  });

  while (!settled) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    if (settled) break;
    const total = downloader.totalSize;
    const downloaded = downloader.downloadedSize;
    if (total && total > 0 && downloaded !== undefined) {
      const pct = Math.min(99, Math.round((downloaded / total) * 100));
      emit({ type: "phase", message: "Downloading model", progress: pct });
    }
  }

  if (downloadError) throw downloadError;
  if (modelPath === undefined) throw new Error("Model download failed: no path returned");

  resolvedPaths.set(getConfigKey(model), modelPath);

  emit({ type: "finish", data: { model: input.model! } });
};
