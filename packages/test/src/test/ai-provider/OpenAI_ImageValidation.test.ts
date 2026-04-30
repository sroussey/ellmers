/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { registerOpenAiImageValidator } from "@workglow/ai-provider/openai";
import { AiImageOutputTask, ImageEditTask, ProviderUnsupportedFeatureError } from "@workglow/ai";

describe("OpenAI image validator", () => {
  beforeEach(() => {
    AiImageOutputTask.unregisterProviderImageValidator("OPENAI");
    registerOpenAiImageValidator();
  });
  afterEach(() => {
    AiImageOutputTask.unregisterProviderImageValidator("OPENAI");
  });

  it("rejects DALL-E 2 with additionalImages", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: {
          model_id: "dall-e-2",
          provider: "OPENAI",
          title: "",
          description: "",
          tasks: ["ImageEditTask"],
          provider_config: { model_name: "dall-e-2" },
          metadata: {},
        } as any,
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
        additionalImages: ["data:image/png;base64,iVBORw0KGgo="] as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).rejects.toBeInstanceOf(
      ProviderUnsupportedFeatureError,
    );
  });

  it("accepts gpt-image-2 with additionalImages", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: {
          model_id: "gpt-image-2",
          provider: "OPENAI",
          title: "",
          description: "",
          tasks: ["ImageEditTask"],
          provider_config: { model_name: "gpt-image-2" },
          metadata: {},
        } as any,
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
        additionalImages: ["data:image/png;base64,iVBORw0KGgo="] as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).resolves.toBe(true);
  });
});
