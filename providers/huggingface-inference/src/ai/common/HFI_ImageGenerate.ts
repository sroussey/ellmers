/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
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
 * One-shot stream wrapper. HF Inference does not support partial image streaming,
 * so we run the request, yield one snapshot, then finish.
 */
export const HFI_ImageGenerate_Stream: AiProviderStreamFn<
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ImageGenerateTaskOutput>> {
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
  yield { type: "snapshot", data: result } as StreamEvent<ImageGenerateTaskOutput>;
  yield { type: "finish", data: {} as ImageGenerateTaskOutput };
};
