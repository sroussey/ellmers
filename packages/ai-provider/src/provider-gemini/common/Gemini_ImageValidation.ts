/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiImageOutputTask, ProviderUnsupportedFeatureError } from "@workglow/ai";
import type { ModelConfig } from "@workglow/ai";

import { GOOGLE_GEMINI } from "./Gemini_Constants";

/**
 * Registers the Gemini per-provider image validator. Called at provider registration time
 * (both inline and worker-backed paths) so it runs on the main thread before any dispatch.
 *
 * Currently validates:
 * - ImageEditTask + non-null mask → throws (Gemini does not support mask-based inpainting).
 */
export function registerGeminiImageValidator(): void {
  AiImageOutputTask.registerProviderImageValidator(
    GOOGLE_GEMINI,
    (taskType, input, model: ModelConfig) => {
      if (taskType !== "ImageEditTask") return;
      if (input["mask"] !== undefined && input["mask"] !== null) {
        throw new ProviderUnsupportedFeatureError(
          "mask",
          model.model_id ?? "gemini",
          "Gemini does not support mask-based inpainting; remove the mask or use OpenAI gpt-image-2",
        );
      }
    },
  );
}
