/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelConfig } from "@workglow/ai";
import { AiProviderRegistry, ModelDownloadTask, setAiProviderRegistry } from "@workglow/ai";
import { describe, expect, it } from "vitest";

const MOCK_PROVIDER = "mock-one-shot-phase-provider";

describe("AiTask phase emissions", () => {
  it("surfaces provider phase events as progress for one-shot tasks", async () => {
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);

    const runFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "phase", message: "Downloading model", progress: 42 });
      emit({ type: "finish", data: { model: "downloaded-model" } });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["model.download"], runFn });

    const model: ModelConfig = {
      model_id: "downloaded-model",
      title: "downloaded-model",
      description: "test",
      capabilities: [],
      provider: MOCK_PROVIDER,
      provider_config: {},
      metadata: {},
    };
    const task = new ModelDownloadTask();
    const events: Array<{ progress: number | undefined; message: string | undefined }> = [];
    task.subscribe("progress", (progress, message) => events.push({ progress, message }));

    await task.run({ model });

    expect(events).toContainEqual({ progress: 42, message: "Downloading model" });
  });
});
