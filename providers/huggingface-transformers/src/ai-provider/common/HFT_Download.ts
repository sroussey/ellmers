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
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for downloading and caching a Hugging Face Transformers model.
 * This is shared between inline and worker implementations.
 */
export const HFT_Download: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:Download:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  // Download the model by creating a pipeline
  // Use 100 as progressScaleMax since this is download-only (0-100%)
  await getPipeline(model!, onProgress, {}, signal, 100);

  logger.timeEnd(timerLabel, { model: model?.provider_config.model_path });
  return {
    model: input.model!,
  };
};
