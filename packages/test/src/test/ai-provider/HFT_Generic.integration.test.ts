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
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const TEXT_MODEL_ID = "onnx:onnx-community/Qwen2.5-1.5B-Instruct:q4";
const THINKING_MODEL_ID = "onnx:LiquidAI/LFM2.5-1.2B-Thinking-WebGPU:q4";
const INSTRUCT_MODEL_ID = "onnx:LiquidAI/LFM2.5-1.2B-Instruct-WebGPU:q4";

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

runAiProviderConformance({
  name: "HFT (HuggingFace Transformers)",
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
  },
  // Local ONNX inference is slow; relax the abort window so the
  // mid-stream-abort assertion has room to fire and shut down cleanly.
  fixture: { maxTokens: 2600, abortGraceMs: 500 },
});
