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
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = true;

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

runGenericAiProviderTests({
  name: "HFT (HuggingFace Transformers)",
  skip: !RUN,
  setup: async () => {
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
  teardown: async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: INSTRUCT_MODEL_ID,
  toolCallingModel: INSTRUCT_MODEL_ID,
  structuredGenerationModel: INSTRUCT_MODEL_ID,
  agentModel: INSTRUCT_MODEL_ID,
  maxTokens: 2600,
  timeout: 300000,
});
