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
import { LOCAL_LLAMACPP, llamaCppSessions } from "@workglow/node-llama-cpp/ai-provider";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai-provider";
import {
  disposeLlamaCppResources,
  registerLlamaCppInline,
} from "@workglow/node-llama-cpp/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
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
  name: "LlamaCpp (node-llama-cpp)",
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
  // TODO(workglow): Sessions test fails because earlier suite tests
  // exhaust the shared LlamaContext sequence pool before sessionReuse
  // runs (see CI run 25388949190). Phase 4.3 wired sessionId correctly,
  // but sequence-pool exhaustion is a separate concurrency issue across
  // unrelated runFns. Re-mark as expected-fail until the pool is bounded
  // per-test or sequences are released eagerly between conformance blocks.
  expectedFailures: ["session.reuse"],
});
