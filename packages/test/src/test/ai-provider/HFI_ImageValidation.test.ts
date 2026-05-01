/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { registerHfImageValidator } from "@workglow/ai-provider/hf-inference";
import { AiImageOutputTask, ImageEditTask, ProviderUnsupportedFeatureError } from "@workglow/ai";

const HF_INFERENCE = "HF_INFERENCE";

function modelConfig(modelName: string): any {
  return {
    model_id: modelName,
    provider: HF_INFERENCE,
    title: "",
    description: "",
    tasks: ["ImageEditTask"],
    provider_config: { model_name: modelName },
    metadata: {},
  };
}

describe("HFI image validator", () => {
  beforeEach(() => {
    AiImageOutputTask.unregisterProviderImageValidator(HF_INFERENCE);
    registerHfImageValidator();
  });
  afterEach(() => {
    AiImageOutputTask.unregisterProviderImageValidator(HF_INFERENCE);
  });

  it("rejects mask on a non-inpainting model", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: modelConfig("black-forest-labs/FLUX.1-schnell"),
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
        mask: "data:image/png;base64,iVBORw0KGgo=" as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).rejects.toBeInstanceOf(
      ProviderUnsupportedFeatureError,
    );
  });

  it("accepts mask on an inpainting model (Kontext)", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: modelConfig("black-forest-labs/FLUX.1-Kontext-dev"),
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
        mask: "data:image/png;base64,iVBORw0KGgo=" as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).resolves.toBe(true);
  });

  it("rejects non-empty additionalImages on any HF model", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: modelConfig("black-forest-labs/FLUX.1-Kontext-dev"),
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
        additionalImages: ["data:image/png;base64,iVBORw0KGgo="] as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).rejects.toBeInstanceOf(
      ProviderUnsupportedFeatureError,
    );
  });
});
