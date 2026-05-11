/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { LLAMACPP_DEFAULT_MODELS_DIR } from "./LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getConfigKey, loadSdk, resolvedPaths } from "./LlamaCpp_Runtime";

export const LlamaCpp_Download: AiProviderStreamFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  LlamaCppModelConfig
> = async function* (input, model): AsyncIterable<StreamEvent<DownloadModelTaskRunOutput>> {
  if (!model) throw new Error("Model config is required for DownloadModelTask.");

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

  // Poll progress while download is in flight, yielding phase events.
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
      yield {
        type: "phase",
        message: "Downloading model",
        progress: pct,
      };
    }
  }

  if (downloadError) throw downloadError;
  if (modelPath === undefined) throw new Error("Model download failed: no path returned");

  resolvedPaths.set(getConfigKey(model), modelPath);

  yield { type: "finish", data: { model: input.model! } };
};
