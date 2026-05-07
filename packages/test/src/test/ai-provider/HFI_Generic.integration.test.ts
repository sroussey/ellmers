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
import { HF_INFERENCE } from "@workglow/huggingface-inference/ai-provider";
import { registerHfInferenceInline } from "@workglow/huggingface-inference/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.HF_TOKEN;
const MODEL_ID = "hf-inference:meta-llama/Llama-3.1-8B-Instruct";
const EMBED_MODEL_ID = "hf-inference:sentence-transformers/all-MiniLM-L6-v2";

runAiProviderConformance({
  name: "HuggingFace Inference",
  skip: !RUN,
  timeout: 60_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerHfInferenceInline();
      await getGlobalModelRepository().addModel({
        model_id: MODEL_ID,
        title: "Llama 3.1 8B Instruct (HF Inference)",
        description: "Llama 3.1 8B Instruct via HuggingFace Inference API",
        tasks: ["TextGenerationTask", "TextRewriterTask", "TextSummaryTask", "ToolCallingTask"],
        provider: HF_INFERENCE as typeof HF_INFERENCE,
        provider_config: { model_name: "meta-llama/Llama-3.1-8B-Instruct" },
        metadata: {},
      });
      await getGlobalModelRepository().addModel({
        model_id: EMBED_MODEL_ID,
        title: "All-MiniLM-L6-v2 (HF Inference)",
        description: "sentence-transformers/all-MiniLM-L6-v2 via HF Inference",
        tasks: ["TextEmbeddingTask"],
        provider: HF_INFERENCE as typeof HF_INFERENCE,
        provider_config: { model_name: "sentence-transformers/all-MiniLM-L6-v2" },
        metadata: {},
      });
    },
    dispose: async () => {
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({}),
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: false,
    embeddings: true,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: MODEL_ID,
    toolCalling: MODEL_ID,
    embeddings: EMBED_MODEL_ID,
  },
});
