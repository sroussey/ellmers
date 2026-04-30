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
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "gemini"
  );
}

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

/** Non-streaming path. */
export const Gemini_ImageEdit: AiProviderRunFn<
  ImageEditTaskInput,
  ImageEditTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `gemini:ImageEdit:${modelIdOf(model)}`;
  logger.time(timer, { model: modelIdOf(model) });
  update_progress(0, "Starting Gemini image edit");

  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const modelName = getModelName(model);
  const genModel = genAI.getGenerativeModel({ model: modelName });

  // image/additionalImages may be data URI strings if the input crossed
  // an earlier worker boundary in legacy form; otherwise they are ImageValue
  // POJOs from the standard image hydration resolver.
  const primaryPart = await gpuImageToInlinePart(
    input.image as unknown as ImageValue | string
  );

  const additionalParts: Array<{ inlineData: { mimeType: string; data: string } }> =
    input.additionalImages &&
    (input.additionalImages as Array<ImageValue | string>).length > 0
      ? await Promise.all(
          (input.additionalImages as Array<ImageValue | string>).map((g) =>
            gpuImageToInlinePart(g)
          )
        )
      : [];

  const parts: Array<any> = [{ text: input.prompt }, primaryPart, ...additionalParts];

  try {
    const result = await genModel.generateContent({ contents: [{ role: "user", parts }] }, {
      signal,
    } as any);

    const response = result.response;

    // Check for safety blocks
    if (
      !response.candidates ||
      response.candidates.length === 0 ||
      response.promptFeedback?.blockReason
    ) {
      const reason = response.promptFeedback?.blockReason ?? "SAFETY";
      throw new ImageGenerationContentPolicyError(modelIdOf(model), `Blocked: ${reason}`);
    }

    // Find the inline image part
    const candidateParts = response.candidates[0]?.content?.parts ?? [];
    const imagePart = candidateParts.find(
      (p: any) => p.inlineData && p.inlineData.mimeType && p.inlineData.data
    ) as { inlineData: { mimeType: string; data: string } } | undefined;

    if (!imagePart) {
      throw new ImageGenerationProviderError(
        modelIdOf(model),
        "No image part in response (Gemini did not return an inline image)"
      );
    }

    const image = await decodeInlineImage(imagePart.inlineData.mimeType, imagePart.inlineData.data);
    update_progress(100, "Completed Gemini image edit");
    logger.timeEnd(timer, { model: modelIdOf(model) });
    return { image };
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/safety|policy|moderation|blocked|SAFETY|PROHIBITED/i.test(msg)) {
      throw new ImageGenerationContentPolicyError(modelIdOf(model), msg);
    }
    throw new ImageGenerationProviderError(modelIdOf(model), msg, { cause: err as Error });
  }
};

/**
 * One-shot stream wrapper. Gemini does not support partial image streaming,
 * so we call the non-streaming run function, yield one snapshot, then finish.
 */
export const Gemini_ImageEdit_Stream: AiProviderStreamFn<
  ImageEditTaskInput,
  ImageEditTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ImageEditTaskOutput>> {
  const noop = () => {};
  const result = await Gemini_ImageEdit(input, model, noop, signal);
  yield { type: "snapshot", data: result } as StreamEvent<ImageEditTaskOutput>;
  yield { type: "finish", data: {} as ImageEditTaskOutput };
};
