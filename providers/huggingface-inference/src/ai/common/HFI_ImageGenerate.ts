/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";

import { blobToImageValue } from "@workglow/ai/provider-utils";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName } from "./HFI_Client";
import { resolveHfImageDims } from "./HFI_AspectRatio";

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "huggingface"
  );
}

/**
 * One-shot run fn. HF Inference does not support partial image streaming,
 * so we run the request, emit one snapshot, then finish.
 */
export const HFI_ImageGenerate_Stream: AiProviderRunFn<
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timer = `hfi:ImageGenerate:${getModelName(model)}`;
  logger.time(timer);

  let result: ImageGenerateTaskOutput;
  try {
    const client = await getClient(model);
    const modelName = getModelName(model);
    const dims = resolveHfImageDims(modelName, (input.aspectRatio as any) ?? "1:1");

    const blob: Blob = await client.textToImage(
      {
        model: modelName,
        inputs: input.prompt,
        parameters: {
          width: dims.width,
          height: dims.height,
          seed: input.seed,
          negative_prompt: input.negativePrompt,
          ...(input.providerOptions ?? {}),
        },
      },
      { outputType: "blob" as const, signal }
    );
    const image = await blobToImageValue(blob);
    logger.timeEnd(timer);
    result = { image };
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    )
      throw err;
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/NSFW|safety|policy/i.test(msg))
      throw new ImageGenerationContentPolicyError(modelIdOf(model), msg);
    throw new ImageGenerationProviderError(modelIdOf(model), msg, { cause: err as Error });
  }

  if (signal.aborted) return;
  emit({ type: "finish", data: result });
};
