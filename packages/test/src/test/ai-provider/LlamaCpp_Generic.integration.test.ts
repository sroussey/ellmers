/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DownloadModelTask,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import { LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai-provider";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai-provider";
import {
  disposeLlamaCppResources,
  registerLlamaCppInline,
} from "@workglow/node-llama-cpp/ai-provider-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const llmModel: LlamaCppModelRecord = {
  model_id: "llamacpp:SmolLM2-135M-Instruct:Q4_K_M",
  title: "SmolLM2 135M Instruct",
  description: "A 135M parameter instruction-following model, quantized Q4_K_M (~85 MB)",
  tasks: ["DownloadModelTask", "TextGenerationTask", "TextRewriterTask", "TextSummaryTask"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/SmolLM2-135M-Instruct-Q4_K_M.gguf",
    model_url: "hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    context_size: 512,
    flash_attention: false,
  },
  metadata: {},
};

const lfm2ToolModel: LlamaCppModelRecord = {
  model_id: "llamacpp:LiquidAI/LFM2-1.2B-Tool:Q8_0",
  title: "LFM2 1.2B Tool",
  description:
    "A 1.2B parameter instruction-following model with tool calling support, quantized Q8_0",
  tasks: [
    "DownloadModelTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "StructuredGenerationTask",
  ],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/LiquidAI/LFM2-1.2B-Tool-GGUF.Q8_0.gguf",
    model_url: "hf:LiquidAI/LFM2-1.2B-Tool-GGUF:Q8_0",
    models_dir: "./models",
    flash_attention: true,
    seed: 42,
  },
  metadata: {},
};

const qwen25CoderToolModel: LlamaCppModelRecord = {
  model_id: "llamacpp:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
  title: "Qwen2.5 Coder 1.5B Instruct",
  description:
    "A 1.5B parameter instruction-following model with tool calling support, quantized Q4_K_M",
  tasks: [
    "DownloadModelTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "StructuredGenerationTask",
  ],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF.Q4_K_M.gguf",
    model_url: "hf:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    flash_attention: true,
    seed: 42,
  },
  metadata: {},
};

const llama3d21bToolModel: LlamaCppModelRecord = {
  model_id: "llamacpp:unsloth/Llama-3.2-1B-Instruct-GGUF:Q4_K_M",
  title: "Llama 3.2 1B Instruct",
  description:
    "A 1B parameter instruction-following model with tool calling support, quantized Q4_K_M",
  tasks: ["TextGenerationTask", "ToolCallingTask", "StructuredGenerationTask", "AgentTask"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/unsloth/Llama-3.2-1B-Instruct-GGUF.Q4_K_M.gguf",
    model_url: "hf:unsloth/Llama-3.2-1B-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    flash_attention: true,
    seed: 42,
  },
  metadata: {},
};

const toolModelId = qwen25CoderToolModel.model_id; // or lfm2ToolModel.model_id or llmModel.model_id or llama3d21bToolModel.model_id
const llmModelId = llmModel.model_id;

runGenericAiProviderTests({
  name: "LlamaCpp (node-llama-cpp)",
  setup: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerLlamaCppInline();

    await getGlobalModelRepository().addModel(llmModel);
    await getGlobalModelRepository().addModel(lfm2ToolModel);
    await getGlobalModelRepository().addModel(qwen25CoderToolModel);
    await getGlobalModelRepository().addModel(llama3d21bToolModel);

    for (const modelId of [llmModelId, toolModelId]) {
      const download = new DownloadModelTask({ defaults: { model: modelId } });
      download.on("progress", (progress, _message, details) => {
        logger.info(
          `Download ${modelId}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
        );
      });
      await download.run();
    }
  },
  teardown: async () => {
    await disposeLlamaCppResources();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: llmModelId,
  toolCallingModel: toolModelId,
  structuredGenerationModel: toolModelId,
  agentModel: toolModelId,
  maxTokens: 200,
  timeout: 10 * 60 * 1000, // 10 min: download (~292 MB) + inference
});
