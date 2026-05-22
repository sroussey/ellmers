/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiChatWithKbTask, registerAiTasks, type ModelConfig } from "@workglow/ai";
import { TaskConfigurationError } from "@workglow/task-graph";
import { beforeAll, describe, expect, it } from "vitest";

describe("AiTask.validateInput — per-port model: semantics", () => {
  beforeAll(() => {
    registerAiTasks();
  });
  it("accepts an embedding model on AiChatWithKbTask.embeddingModel", async () => {
    const chatModel: ModelConfig = {
      model_id: "chat-model",
      title: "Chat",
      description: "Chat",
      provider: "fake",
      capabilities: ["text.generation"],
      provider_config: {},
      metadata: {},
    };
    const embeddingModel: ModelConfig = {
      model_id: "c0d975d2-bed1-4fdc-bd17-0b32e4ec98d8",
      title: "Embedder",
      description: "Embedder",
      provider: "fake",
      capabilities: ["text.embedding"],
      provider_config: {},
      metadata: {},
    };

    const task = new AiChatWithKbTask();
    await expect(
      task.validateInput({
        model: chatModel,
        embeddingModel,
        prompt: "hello",
        knowledgeBaseIds: ["kb1"],
      } as never)
    ).resolves.toBe(true);
  });

  it("rejects a generation model on AiChatWithKbTask.embeddingModel", async () => {
    const chatModel: ModelConfig = {
      model_id: "chat-model",
      title: "Chat",
      description: "Chat",
      provider: "fake",
      capabilities: ["text.generation"],
      provider_config: {},
      metadata: {},
    };
    const wrongEmbeddingModel: ModelConfig = {
      model_id: "wrong-model",
      title: "Wrong",
      description: "Wrong",
      provider: "fake",
      capabilities: ["text.generation"],
      provider_config: {},
      metadata: {},
    };

    const task = new AiChatWithKbTask();
    await expect(
      task.validateInput({
        model: chatModel,
        embeddingModel: wrongEmbeddingModel,
        prompt: "hello",
        knowledgeBaseIds: ["kb1"],
      } as never)
    ).rejects.toBeInstanceOf(TaskConfigurationError);
  });
});
