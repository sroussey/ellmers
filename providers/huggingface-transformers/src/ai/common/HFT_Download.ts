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
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for downloading and caching a Hugging Face Transformers model.
 * This is shared between inline and worker implementations.
 *
 * The download is the entire operation, so progress is forwarded via `phase`
 * stream events through the `emit` callback passed to {@link getPipeline}. The
 * {@link StreamProcessor} consumer translates each phase event into a task-level
 * progress callback.
 */
export const HFT_Download: AiProviderRunFn<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timerLabel = `hft:Download:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  // Download the model by creating a pipeline. Use 100 as progressScaleMax
  // since this is download-only (0-100%).
  await getPipeline(model!, emit, {}, signal, 100);

  logger.timeEnd(timerLabel, { model: model?.provider_config.model_path });
  emit({ type: "finish", data: { model: input.model! } });
};
