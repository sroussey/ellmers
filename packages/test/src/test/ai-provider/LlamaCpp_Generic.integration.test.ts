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
import { LOCAL_LLAMACPP, registerLlamaCpp } from "@workglow/node-llama-cpp/ai-provider";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai-provider";
import {
  disposeLlamaCppResources,
  llamaCppSessions,
  recycleLlamaCppTextContext,
  registerLlamaCppInline,
  releaseLlamaCppTransientSessions,
} from "@workglow/node-llama-cpp/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";
import { getTestingLogger } from "../../binding/TestingLogger";

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

const toolModel: LlamaCppModelRecord = {
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

const embeddingModel: LlamaCppModelRecord = {
  model_id: "llamacpp:bge-small-en-v1.5:Q8_0",
  title: "BGE Small EN v1.5",
  description: "A small English text embedding model, quantized Q8_0 (~34 MB)",
  tasks: ["DownloadModelTask", "TextEmbeddingTask"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/bge-small-en-v1.5-Q8_0.gguf",
    model_url: "hf:CompendiumLabs/bge-small-en-v1.5-gguf:Q8_0",
    models_dir: "./models",
    embedding: true,
  },
  metadata: {},
};

runAiProviderConformance({
  name: "LlamaCpp (node-llama-cpp) (inline)",
  timeout: 10 * 60 * 1000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerLlamaCppInline();
      await getGlobalModelRepository().addModel(llmModel);
      await getGlobalModelRepository().addModel(toolModel);
      await getGlobalModelRepository().addModel(embeddingModel);
      for (const modelId of [llmModel.model_id, toolModel.model_id, embeddingModel.model_id]) {
        const download = new DownloadModelTask({ defaults: { model: modelId } });
        download.on("progress", (progress, _message, details) => {
          logger.info(
            `Download ${modelId}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
          );
        });
        await download.run();
      }
    },
    dispose: async () => {
      await disposeLlamaCppResources();
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({ sessionMap: llamaCppSessions }),
    releaseTransients: async () => {
      await releaseLlamaCppTransientSessions();
      // Earlier conformance blocks (signal mid-stream abort in particular)
      // can leak sequence-pool slots that aren't reclaimed by disposing the
      // LlamaContext alone. Reload the LlamaModel so session.reuse starts
      // with a truly fresh sequence pool.
      await recycleLlamaCppTextContext(llmModel.provider_config.model_url!, {
        reloadModel: true,
      });
    },
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: true,
    sessions: true,
    abortMidStream: true,
  },
  models: {
    textGeneration: llmModel.model_id,
    toolCalling: toolModel.model_id,
    structured: toolModel.model_id,
    embeddings: embeddingModel.model_id,
  },
  fixture: { maxTokens: 200, abortGraceMs: 500 },
});

const llamaCppWorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerLlamaCpp({
      worker: () =>
        new Worker(new URL("./worker_llamacpp_test.ts", import.meta.url), { type: "module" }),
    });
    await getGlobalModelRepository().addModel(llmModel);
    await getGlobalModelRepository().addModel(toolModel);
    await getGlobalModelRepository().addModel(embeddingModel);
    for (const modelId of [llmModel.model_id, toolModel.model_id, embeddingModel.model_id]) {
      const download = new DownloadModelTask({ defaults: { model: modelId } });
      download.on("progress", (progress, _message, details) => {
        logger.info(
          `Download ${modelId}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
        );
      });
      await download.run();
    }
  },
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "LlamaCpp (node-llama-cpp) (worker)",
  timeout: 10 * 60 * 1000,
  factory: llamaCppWorkerFactory,
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: true,
    sessions: true,
    abortMidStream: true,
  },
  models: {
    textGeneration: llmModel.model_id,
    toolCalling: toolModel.model_id,
    structured: toolModel.model_id,
    embeddings: embeddingModel.model_id,
  },
  fixture: { maxTokens: 200, abortGraceMs: 500 },
});

runWorkerProxyBoundary({
  name: "LlamaCpp (node-llama-cpp)",
  timeout: 10 * 60 * 1000,
  factory: llamaCppWorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: llmModel.model_id, toolCalling: toolModel.model_id },
});
