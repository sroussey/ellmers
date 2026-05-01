/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ImageEditTaskInput,
  ImageEditTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { getLogger } from "@workglow/util/worker";

import { dataUriToImageValue, imageValueToPngBytes } from "../../common/imageOutputHelpers";
import { getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

type OpenAiImageInput = ImageValue | string;

function aspectRatioToSize(
  aspectRatio: string | undefined
): "1024x1024" | "1024x1536" | "1536x1024" {
  switch (aspectRatio) {
    case "16:9":
    case "4:3":
      return "1536x1024";
    case "9:16":
    case "3:4":
      return "1024x1536";
    case "1:1":
    default:
      return "1024x1024";
  }
}

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "openai"
  );
}

/**
 * Encode an inbound `ImageValue` (or a serialized data URI from the worker
 * boundary) to PNG bytes wrapped in a File suitable for the OpenAI multipart
 * upload. Uses `OpenAI.toFile` when available (SDK v4+), otherwise falls
 * back to `new File(...)`.
 */
async function gpuImageToOpenAiFile(image: OpenAiImageInput, name: string): Promise<unknown> {
  const bytes = await imageValueToPngBytes(image);
  // Copy to a plain ArrayBuffer to avoid SharedArrayBuffer typing issues with BlobPart.
  const buffer: ArrayBuffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : new Uint8Array(bytes).buffer;
  const sdk = (await import("openai")) as unknown as {
    toFile?: (input: unknown, name?: string, options?: { type?: string }) => Promise<unknown>;
  };
  if (typeof sdk.toFile === "function") {
    return sdk.toFile(new Blob([buffer], { type: "image/png" }), name, { type: "image/png" });
  }
  return new File([buffer], name, { type: "image/png" });
}

async function decodeB64Png(b64: string): Promise<ImageValue> {
  return dataUriToImageValue(`data:image/png;base64,${b64}`);
}

async function buildEditPayload(
  input: ImageEditTaskInput,
  model: OpenAiModelConfig | undefined
): Promise<Record<string, unknown>> {
  const modelName = getModelName(model);
  // image/mask/additionalImages may be data URI strings when the input crossed
  // the worker boundary via AiImageOutputTask.getJobInput materialization.
  const primary = await gpuImageToOpenAiFile(
    input.image as unknown as OpenAiImageInput,
    "image.png"
  );
  const additionalFiles =
    input.additionalImages && (input.additionalImages as OpenAiImageInput[]).length > 0
      ? await Promise.all(
          (input.additionalImages as OpenAiImageInput[]).map((g, i) =>
            gpuImageToOpenAiFile(g, `image-${i + 1}.png`)
          )
        )
      : [];
  const imageField = additionalFiles.length === 0 ? primary : [primary, ...additionalFiles];

  const payload: Record<string, unknown> = {
    model: modelName,
    prompt: input.prompt,
    image: imageField,
    size: aspectRatioToSize(input.aspectRatio),
    quality: input.quality,
    n: 1,
    ...(input.providerOptions ?? {}),
  };
  if (input.mask) {
    payload.mask = await gpuImageToOpenAiFile(
      input.mask as unknown as OpenAiImageInput,
      "mask.png"
    );
  }
  return payload;
}

export const OpenAI_ImageEdit: AiProviderRunFn<
  ImageEditTaskInput,
  ImageEditTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `openai:ImageEdit:${getModelName(model)}`;
  logger.time(timer);
  update_progress(0, "Starting OpenAI image edit");

  const client = await getClient(model);

  try {
    const payload = await buildEditPayload(input, model);
    const resp = (await (client.images.edit as Function)(payload, { signal })) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) {
      throw new ImageGenerationProviderError(modelIdOf(model), "Empty response (no b64_json)");
    }
    const image = await decodeB64Png(b64);
    update_progress(100, "Completed OpenAI image edit");
    logger.timeEnd(timer);
    return { image };
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/safety|policy|moderation/i.test(msg)) {
      throw new ImageGenerationContentPolicyError(modelIdOf(model), msg);
    }
    throw new ImageGenerationProviderError(modelIdOf(model), msg, { cause: err as Error });
  }
};

/**
 * Streaming edit path. Yields snapshot events for each partial + final image, then finish.
 * SDK v6.35+ supports `stream: true` on `images.edit` for GPT image models.
 */
export const OpenAI_ImageEdit_Stream: AiProviderStreamFn<
  ImageEditTaskInput,
  ImageEditTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ImageEditTaskOutput>> {
  const client = await getClient(model);

  try {
    const payload = await buildEditPayload(input, model);
    const stream = (await (client.images.edit as Function)(
      { ...payload, stream: true, partial_images: 3 },
      { signal }
    )) as AsyncIterable<{ b64_json?: string }>;

    for await (const event of stream) {
      if (signal.aborted) return;
      const b64 = event.b64_json;
      if (!b64) continue;
      const image = await decodeB64Png(b64);
      yield { type: "snapshot", data: { image } } as StreamEvent<ImageEditTaskOutput>;
    }
    yield { type: "finish", data: {} as ImageEditTaskOutput };
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/safety|policy|moderation/i.test(msg)) {
      throw new ImageGenerationContentPolicyError(modelIdOf(model), msg);
    }
    throw new ImageGenerationProviderError(modelIdOf(model), msg, { cause: err as Error });
  }
};
