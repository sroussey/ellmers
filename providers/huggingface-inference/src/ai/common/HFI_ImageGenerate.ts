/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";

import { blobToImageValue, modelIdForError } from "@workglow/ai/provider-utils";
import { resolveHfImageDims } from "./HFI_AspectRatio";
import { getClient, getModelName } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

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
      throw new ImageGenerationContentPolicyError(modelIdForError(model, "huggingface"), msg);
    throw new ImageGenerationProviderError(modelIdForError(model, "huggingface"), msg, {
      cause: err as Error,
    });
  }

  if (signal.aborted) return;
  emit({ type: "finish", data: result });
};
