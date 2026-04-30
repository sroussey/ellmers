/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { getLogger } from "@workglow/util/worker";

import { dataUriToImageValue } from "../../common/imageOutputHelpers";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

/** Maps the normalized aspect ratio to gpt-image-2 / DALL-E supported sizes. */
function aspectRatioToSize(
  aspectRatio: string | undefined,
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

async function decodeB64Png(b64: string): Promise<ImageValue> {
  return dataUriToImageValue(`data:image/png;base64,${b64}`);
}

function modelIdOf(model: ModelConfig | undefined): string {
  return model?.model_id ?? (model?.provider_config as { model_name?: string } | undefined)?.model_name ?? "openai";
}

/** Non-streaming path. Used for DALL-E or when streaming is not requested. */
export const OpenAI_ImageGenerate: AiProviderRunFn<
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `openai:ImageGenerate:${getModelName(model)}`;
  logger.time(timer);
  update_progress(0, "Starting OpenAI image generation");

  const client = await getClient(model);
  const modelName = getModelName(model);
  const size = aspectRatioToSize(input.aspectRatio);

  try {
    const resp = await client.images.generate(
      {
        model: modelName,
        prompt: input.prompt,
        size,
        quality: input.quality as "standard" | "hd" | "low" | "medium" | "high" | "auto" | undefined,
        n: 1,
        response_format: "b64_json",
        ...(input.providerOptions ?? {}),
      } as Parameters<typeof client.images.generate>[0],
      { signal },
    );

    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) {
      throw new ImageGenerationProviderError(modelIdOf(model), "Empty response (no b64_json)");
    }
    const image = await decodeB64Png(b64);
    update_progress(100, "Completed OpenAI image generation");
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
 * Streaming path. Yields snapshot events for each partial + final image, then finish.
 * Uses SDK v6+ streaming support: `stream: true` + `partial_images: 3` on GPT image models.
 * DALL-E 3 does not support streaming (the SDK overload for stream=true is not valid for it),
 * so this function falls back to the non-streaming path for DALL-E models.
 */
export const OpenAI_ImageGenerate_Stream: AiProviderStreamFn<
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ImageGenerateTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const size = aspectRatioToSize(input.aspectRatio);

  // DALL-E 2 and DALL-E 3 do not support streaming — fall back to non-streaming.
  if (modelName.startsWith("dall-e")) {
    try {
      const resp = await (client.images.generate as Function)(
        {
          model: modelName,
          prompt: input.prompt,
          size,
          quality: input.quality,
          n: 1,
          response_format: "b64_json",
          ...(input.providerOptions ?? {}),
        },
        { signal },
      );
      const b64 = resp.data?.[0]?.b64_json;
      if (!b64) {
        throw new ImageGenerationProviderError(modelIdOf(model), "Empty response (no b64_json)");
      }
      const image = await decodeB64Png(b64);
      yield { type: "snapshot", data: { image } } as StreamEvent<ImageGenerateTaskOutput>;
      yield { type: "finish", data: {} as ImageGenerateTaskOutput };
      return;
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
  }

  // GPT image models support streaming.
  try {
    const stream = await client.images.generate(
      {
        model: modelName,
        prompt: input.prompt,
        size,
        quality: input.quality as "low" | "medium" | "high" | "auto" | undefined,
        n: 1,
        stream: true,
        partial_images: 3,
        ...(input.providerOptions ?? {}),
      },
      { signal },
    );

    for await (const event of stream) {
      if (signal.aborted) return;
      const b64 = event.b64_json;
      if (!b64) continue;
      const image = await decodeB64Png(b64);
      yield { type: "snapshot", data: { image } } as StreamEvent<ImageGenerateTaskOutput>;
    }
    yield { type: "finish", data: {} as ImageGenerateTaskOutput };
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
