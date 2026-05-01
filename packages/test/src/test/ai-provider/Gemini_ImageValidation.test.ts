/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { registerGeminiImageValidator } from "@workglow/ai-provider/gemini";
import { AiImageOutputTask, ImageEditTask, ProviderUnsupportedFeatureError } from "@workglow/ai";

describe("Gemini image validator", () => {
  beforeEach(() => {
    AiImageOutputTask.unregisterProviderImageValidator("GOOGLE_GEMINI");
    registerGeminiImageValidator();
  });
  afterEach(() => {
    AiImageOutputTask.unregisterProviderImageValidator("GOOGLE_GEMINI");
  });

  it("rejects ImageEditTask with mask", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: {
          model_id: "gemini-2.5-flash-preview-05-20",
          provider: "GOOGLE_GEMINI",
          title: "",
          description: "",
          tasks: ["ImageEditTask"],
          provider_config: { model_name: "gemini-2.5-flash-preview-05-20" },
          metadata: {},
        } as any,
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
        mask: "data:image/png;base64,iVBORw0KGgo=" as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).rejects.toBeInstanceOf(
      ProviderUnsupportedFeatureError,
    );
  });

  it("accepts ImageEditTask without mask", async () => {
    const task = new ImageEditTask({
      defaults: {
        prompt: "x",
        model: {
          model_id: "gemini-2.5-flash-preview-05-20",
          provider: "GOOGLE_GEMINI",
          title: "",
          description: "",
          tasks: ["ImageEditTask"],
          provider_config: { model_name: "gemini-2.5-flash-preview-05-20" },
          metadata: {},
        } as any,
        image: "data:image/png;base64,iVBORw0KGgo=" as any,
      },
    });
    await expect(task.validateInput(task.runInputData as any)).resolves.toBe(true);
  });
});
