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
import {
  ggufDownloadLockDir,
  ipullRenameDest,
  isBenignIpullRenameRace,
  withGgufDownloadLock,
} from "./LlamaCpp_DownloadLock";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getConfigKey, loadSdk, resolvedPaths } from "./LlamaCpp_Runtime";

export const LlamaCpp_Download: AiProviderRunFn<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadTask.");

  const { resolveModelFile } = await loadSdk();
  const config = model.provider_config;
  const modelUri = config.model_url ?? config.model_path;
  const dirPath = config.models_dir ?? LLAMACPP_DEFAULT_MODELS_DIR;

  const modelPath = await withGgufDownloadLock(ggufDownloadLockDir(dirPath, modelUri), async () => {
    try {
      return await resolveModelFile(modelUri, {
        directory: dirPath,
        cli: false,
        signal,
        onProgress: ({ totalSize, downloadedSize }) => {
          if (totalSize > 0) {
            const pct = Math.min(99, Math.round((downloadedSize / totalSize) * 100));
            emit({ type: "phase", message: "Downloading model", progress: pct });
          }
        },
      });
    } catch (err) {
      const dest = ipullRenameDest(err);
      if (dest !== undefined && isBenignIpullRenameRace(err)) return dest;
      throw err;
    }
  });

  resolvedPaths.set(getConfigKey(model), modelPath);

  emit({ type: "finish", data: { model: input.model! } });
};
