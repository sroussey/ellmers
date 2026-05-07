/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-provider-runtime";
import type { HfTransformersOnnxModelRecord } from "@workglow/huggingface-transformers/ai-provider-runtime";
import { registerHuggingFaceTransformers } from "@workglow/huggingface-transformers/ai-provider";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";
import { getTestingLogger } from "../../binding/TestingLogger";

const TEXT_MODEL_ID = "onnx:onnx-community/Qwen2.5-1.5B-Instruct:q4";
const THINKING_MODEL_ID = "onnx:LiquidAI/LFM2.5-1.2B-Thinking-WebGPU:q4";
const INSTRUCT_MODEL_ID = "onnx:LiquidAI/LFM2.5-1.2B-Instruct-WebGPU:q4";
const EMBED_MODEL_ID = "onnx:Xenova/all-MiniLM-L6-v2:q8";

const textModel: HfTransformersOnnxModelRecord = {
  model_id: TEXT_MODEL_ID,
  title: "Qwen2.5-1.5B-Instruct",
  description: "Instruction-tuned model with native tool calling support",
  tasks: ["TextGenerationTask", "StructuredGenerationTask", "AgentTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "onnx-community/Qwen2.5-1.5B-Instruct",
    dtype: "q4",
    seed: 42,
  },
  metadata: {},
};

const instructModel: HfTransformersOnnxModelRecord = {
  model_id: INSTRUCT_MODEL_ID,
  title: "LFM2.5-1.2B-Instruct-WebGPU",
  description: "Liquid 1.2B Instruct WebGPU",
  tasks: ["TextGenerationTask", "ToolCallingTask", "StructuredGenerationTask", "AgentTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "LiquidAI/LFM2.5-1.2B-Instruct-ONNX",
    dtype: "q4",
    seed: 42,
  },
  metadata: {},
};

const thinkingModel: HfTransformersOnnxModelRecord = {
  model_id: THINKING_MODEL_ID,
  title: "LFM2.5-1.2B-Thinking-WebGPU",
  description: "Liquid 1.2B Thinking WebGPU",
  tasks: ["TextGenerationTask", "ToolCallingTask", "StructuredGenerationTask", "AgentTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "LiquidAI/LFM2.5-1.2B-Thinking-ONNX",
    dtype: "q4",
    seed: 42,
  },
  metadata: {},
};

const embeddingModel: HfTransformersOnnxModelRecord = {
  model_id: EMBED_MODEL_ID,
  title: "All-MiniLM-L6-v2 (384D)",
  description: "Sentence embedding model for the embeddings conformance assertion",
  tasks: ["TextEmbeddingTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/all-MiniLM-L6-v2",
    native_dimensions: 384,
    dtype: "q8",
  },
  metadata: {},
};

runAiProviderConformance({
  name: "HFT (HuggingFace Transformers) (inline)",
  timeout: 300_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      clearPipelineCache();
      await registerHuggingFaceTransformersInline();
      await getGlobalModelRepository().addModel(textModel);
      await getGlobalModelRepository().addModel(thinkingModel);
      await getGlobalModelRepository().addModel(instructModel);
      await getGlobalModelRepository().addModel(embeddingModel);
    },
    dispose: async () => {
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({}),
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: true,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: INSTRUCT_MODEL_ID,
    toolCalling: INSTRUCT_MODEL_ID,
    structured: INSTRUCT_MODEL_ID,
    embeddings: EMBED_MODEL_ID,
  },
  // Local ONNX inference is slow; relax the abort window so the
  // mid-stream-abort assertion has room to fire and shut down cleanly.
  fixture: { maxTokens: 2600, abortGraceMs: 500 },
});

const hftWorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerHuggingFaceTransformers({
      worker: () =>
        new Worker(new URL("./worker_hft_test.ts", import.meta.url), { type: "module" }),
    });
    await getGlobalModelRepository().addModel(textModel);
    await getGlobalModelRepository().addModel(thinkingModel);
    await getGlobalModelRepository().addModel(instructModel);
    await getGlobalModelRepository().addModel(embeddingModel);
  },
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "HFT (HuggingFace Transformers) (worker)",
  timeout: 600_000,
  factory: hftWorkerFactory,
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: true,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: INSTRUCT_MODEL_ID,
    toolCalling: INSTRUCT_MODEL_ID,
    structured: INSTRUCT_MODEL_ID,
    embeddings: EMBED_MODEL_ID,
  },
  fixture: { maxTokens: 2600, abortGraceMs: 500 },
});

runWorkerProxyBoundary({
  name: "HFT (HuggingFace Transformers)",
  timeout: 600_000,
  factory: hftWorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: INSTRUCT_MODEL_ID, toolCalling: INSTRUCT_MODEL_ID },
  // TODO(phase-4): see Anthropic_Generic.integration.test.ts for rationale.
  expectedFailures: ["boundary.disposeTerminatesWorker", "boundary.errorPropagation"],
});
