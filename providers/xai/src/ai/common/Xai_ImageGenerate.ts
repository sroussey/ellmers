/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";

import { dataUriToImageValue, modelIdForError } from "@workglow/ai/provider-utils";
import { getClient, getModelName } from "./Xai_Client";
import type { XaiModelConfig } from "./Xai_ModelSchema";

async function decodeB64Png(b64: string): Promise<ImageValue> {
  return dataUriToImageValue(`data:image/png;base64,${b64}`);
}

/**
 * Run-fn for `["image.generation"]`. The xAI image endpoint (grok-2-image and
 * successors) mirrors the OpenAI `images.generations` shape but does not
 * support streaming, sizes, or quality — it accepts `model` / `prompt` / `n`
 * only. This makes a single non-streaming call requesting base64 output and
 * emits one `snapshot` before `finish`.
 */
export const Xai_ImageGenerate_Stream: AiProviderRunFn<
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  XaiModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  try {
    const resp = await (
      client.images.generate as unknown as (
        body: Record<string, unknown>,
        options: { signal: AbortSignal }
      ) => Promise<{ data?: Array<{ b64_json?: string }> }>
    )(
      {
        model: modelName,
        prompt: input.prompt,
        n: 1,
        response_format: "b64_json",
        ...(input.providerOptions ?? {}),
      },
      { signal }
    );
    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) {
      throw new ImageGenerationProviderError(
        modelIdForError(model, "xai"),
        "Empty response (no b64_json)"
      );
    }
    const image = await decodeB64Png(b64);
    emit({ type: "snapshot", data: { image } } as Parameters<typeof emit>[0]);
    emit({ type: "finish", data: {} as ImageGenerateTaskOutput });
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/safety|policy|moderation/i.test(msg)) {
      throw new ImageGenerationContentPolicyError(modelIdForError(model, "xai"), msg);
    }
    throw new ImageGenerationProviderError(modelIdForError(model, "xai"), msg, {
      cause: err as Error,
    });
  }
};
