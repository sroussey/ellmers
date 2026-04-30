/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiImageOutputTask, ProviderUnsupportedFeatureError } from "@workglow/ai";
import type { ModelConfig } from "@workglow/ai";

import { HF_INFERENCE } from "./HFI_Constants";
import { isHfInpaintingModel } from "./HFI_AspectRatio";

export function registerHfImageValidator(): void {
  AiImageOutputTask.registerProviderImageValidator(
    HF_INFERENCE,
    (taskType, input, model: ModelConfig) => {
      if (taskType !== "ImageEditTask") return;
      const modelId = model.model_id ?? "";
      const modelName =
        (model.provider_config as { model_name?: string } | undefined)?.model_name ?? modelId;

      const additional = input["additionalImages"] as unknown[] | undefined;
      if (Array.isArray(additional) && additional.length > 0) {
        throw new ProviderUnsupportedFeatureError(
          "additionalImages",
          modelId,
          "HF Inference image-to-image only supports a single input image",
        );
      }
      if (input["mask"] !== undefined && input["mask"] !== null && !isHfInpaintingModel(modelName)) {
        throw new ProviderUnsupportedFeatureError(
          "mask",
          modelId,
          "Mask is only supported on HF inpainting models (e.g., FLUX.1-Kontext-dev)",
        );
      }
    },
  );
}
