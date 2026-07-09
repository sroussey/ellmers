/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ImageEditTaskInput, ImageEditTaskOutput } from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";
import { getLogger } from "@workglow/util/worker";

import {
  dataUriToImageValue,
  imageValueToPngBytes,
  modelIdForError,
} from "@workglow/ai/provider-utils";
import { createGeminiClient, getModelName } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

/** Decode a base64 inline image part into an ImageValue. */
async function decodeInlineImage(mimeType: string, data: string): Promise<ImageValue> {
  return dataUriToImageValue(`data:${mimeType};base64,${data}`);
}

/**
 * Encode an inbound `ImageValue` (or a legacy data URI string) as base64 PNG
 * for use in an inlineData Part.
 */
async function gpuImageToInlinePart(
  image: ImageValue | string
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  if (typeof image === "string" && image.startsWith("data:")) {
    // Data URI materialized at an earlier worker boundary — extract base64 directly.
    const base64 = image.replace(/^data:[^;]+;base64,/, "");
    return { inlineData: { mimeType: "image/png", data: base64 } };
  }
  const bytes = await imageValueToPngBytes(image);
  // Convert raw bytes to base64 for the inlineData part. Buffer.toString
  // is used in node; fall back to btoa over chunks in browser-like runtimes.
  let base64: string;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  } else {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return { inlineData: { mimeType: "image/png", data: base64 } };
}

/**
 * Run-fn for `["image.editing"]`. Gemini does not support partial
 * image streaming, so we execute the full edit, emit one snapshot, then
 * a finish event.
 */
export const Gemini_ImageEdit_Stream: AiProviderRunFn<
  ImageEditTaskInput,
  ImageEditTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const timer = `gemini:ImageEdit:${modelIdForError(model, "gemini")}`;
  logger.time(timer, { model: modelIdForError(model, "gemini") });
  try {
    const ai = await createGeminiClient(model);
    const modelName = getModelName(model);

    // image/additionalImages may be data URI strings if the input crossed
    // an earlier worker boundary in legacy form; otherwise they are ImageValue
    // POJOs from the standard image hydration resolver.
    const primaryPart = await gpuImageToInlinePart(input.image as unknown as ImageValue | string);

    const additionalParts: Array<{ inlineData: { mimeType: string; data: string } }> =
      input.additionalImages && (input.additionalImages as Array<ImageValue | string>).length > 0
        ? await Promise.all(
            (input.additionalImages as Array<ImageValue | string>).map((g) =>
              gpuImageToInlinePart(g)
            )
          )
        : [];

    const parts: Array<any> = [{ text: input.prompt }, primaryPart, ...additionalParts];

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts }],
        config: { abortSignal: signal ?? undefined },
      });

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
      emit({ type: "finish", data: {} as ImageEditTaskOutput });
    } catch (err) {
      if (
        err instanceof ImageGenerationProviderError ||
        err instanceof ImageGenerationContentPolicyError
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : "unknown error";
      if (/safety|policy|moderation|blocked|prohibited/i.test(msg)) {
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
