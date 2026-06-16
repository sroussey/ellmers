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
import type { ImageValue } from "@workglow/util/media";
import { getLogger } from "@workglow/util/worker";

import { dataUriToImageValue, modelIdForError } from "@workglow/ai/provider-utils";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

/** Decode a base64 string with an explicit mime type into an ImageValue. */
async function decodeInlineImage(mimeType: string, data: string): Promise<ImageValue> {
  return dataUriToImageValue(`data:${mimeType};base64,${data}`);
}

/**
 * Run-fn for `["image.generation"]`. Gemini does not support partial
 * image streaming, so we execute the full generation, emit one snapshot, then
 * a finish event per the one-shot convention.
 */
export const Gemini_ImageGenerate_Stream: AiProviderRunFn<
  ImageGenerateTaskInput,
  ImageGenerateTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timer = `gemini:ImageGenerate:${modelIdForError(model, "gemini")}`;
  logger.time(timer, { model: modelIdForError(model, "gemini") });
  try {
    const GoogleGenerativeAI = await loadGeminiSDK();
    const genAI = new GoogleGenerativeAI(getApiKey(model));
    const modelName = getModelName(model);
    const genModel = genAI.getGenerativeModel({ model: modelName });

    const parts: Array<{ text: string }> = [{ text: input.prompt }];

    try {
      const result = await genModel.generateContent({ contents: [{ role: "user", parts }] }, {
        signal,
      } as any);

      const response = result.response;

      if (
        !response.candidates ||
        response.candidates.length === 0 ||
        response.promptFeedback?.blockReason
      ) {
        const reason = response.promptFeedback?.blockReason ?? "SAFETY";
        throw new ImageGenerationContentPolicyError(
          modelIdForError(model, "gemini"),
          `Blocked: ${reason}`
        );
      }

      const candidateParts = response.candidates[0]?.content?.parts ?? [];
      const imagePart = candidateParts.find(
        (p: any) => p.inlineData && p.inlineData.mimeType && p.inlineData.data
      ) as { inlineData: { mimeType: string; data: string } } | undefined;

      if (!imagePart) {
        throw new ImageGenerationProviderError(
          modelIdForError(model, "gemini"),
          "No image part in response (Gemini did not return an inline image)"
        );
      }

      const image = await decodeInlineImage(
        imagePart.inlineData.mimeType,
        imagePart.inlineData.data
      );
      emit({ type: "snapshot", data: { image } } as any);
      emit({ type: "finish", data: {} as ImageGenerateTaskOutput });
    } catch (err) {
      if (
        err instanceof ImageGenerationProviderError ||
        err instanceof ImageGenerationContentPolicyError
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : "unknown error";
      if (/safety|policy|moderation|blocked|SAFETY|PROHIBITED/i.test(msg)) {
        throw new ImageGenerationContentPolicyError(modelIdForError(model, "gemini"), msg);
      }
      throw new ImageGenerationProviderError(modelIdForError(model, "gemini"), msg, {
        cause: err as Error,
      });
    }
  } finally {
    logger.timeEnd(timer, { model: modelIdForError(model, "gemini") });
  }
};
