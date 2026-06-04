/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageEditTaskInput,
  ImageEditTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";
import { getLogger } from "@workglow/util/worker";

import { blobToImageValue, imageValueToPngBytes } from "@workglow/ai/provider-utils";
import { resolveHfImageDims } from "./HFI_AspectRatio";
import { getClient, getModelName } from "./HFI_Client";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "huggingface"
  );
}

/**
 * Convert an inbound `ImageValue` (or a legacy data URI string) to a PNG Blob.
 */
async function gpuImageToBlob(image: ImageValue | string): Promise<Blob> {
  const bytes = await imageValueToPngBytes(image);
  // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer typing issues
  // with BlobPart.
  const buffer: ArrayBuffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : new Uint8Array(bytes).buffer;
  return new Blob([buffer], { type: "image/png" });
}

/**
 * One-shot run fn. HF Inference does not support partial image streaming,
 * so we run the request, emit one snapshot, then finish.
 */
export const HFI_ImageEdit_Stream: AiProviderRunFn<
  ImageEditTaskInput,
  ImageEditTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timer = `hfi:ImageEdit:${getModelName(model)}`;
  logger.time(timer);

  let result: ImageEditTaskOutput;
  try {
    const client = await getClient(model);
    const modelName = getModelName(model);
    const dims = resolveHfImageDims(modelName, (input.aspectRatio as any) ?? "1:1");

    // image/mask may be data URI strings if the input crossed an earlier
    // worker boundary in legacy form; otherwise they are ImageValue POJOs.
    const inputBlob = await gpuImageToBlob(input.image as unknown as ImageValue | string);
    const params: Record<string, unknown> = {
      width: dims.width,
      height: dims.height,
      seed: input.seed,
      negative_prompt: input.negativePrompt,
      prompt: input.prompt,
      ...(input.providerOptions ?? {}),
    };
    if (input.mask) {
      const maskBlob = await gpuImageToBlob(input.mask as unknown as ImageValue | string);
      params.mask_image = maskBlob;
    }

    const blob: Blob = await client.imageToImage(
      {
        model: modelName,
        inputs: inputBlob,
        parameters: params,
      },
      { signal }
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
