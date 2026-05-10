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
import type { ImageValue } from "@workglow/util/media";

import { dataUriToImageValue } from "@workglow/ai/provider-utils";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

/** Maps the normalized aspect ratio to gpt-image-2 / DALL-E supported sizes. */
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

async function decodeB64Png(b64: string): Promise<ImageValue> {
  return dataUriToImageValue(`data:image/png;base64,${b64}`);
}

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "openai"
  );
}

/**
 * Streaming run-fn for `["image.generation"]`. GPT-image models support
 * native streaming via `stream: true` + `partial_images: 3` and emit a
 * `snapshot` event per partial frame plus a final snapshot. DALL-E models
 * do not support streaming so this falls back to a single non-streaming
 * call and yields one snapshot before finish.
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
        { signal }
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
      { signal }
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
