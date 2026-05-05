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
import { OLLAMA } from "@workglow/ollama/ai-provider";
import { registerOllamaInline } from "@workglow/ollama/ai-provider-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.OLLAMA_HOST || !!process.env.RUN_OLLAMA_TESTS;
const MODEL_ID = "ollama:llama3.2:1b";

runAiProviderConformance({
  name: "Ollama",
  skip: !RUN,
  timeout: 60_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerOllamaInline();
      await getGlobalModelRepository().addModel({
        model_id: MODEL_ID,
        title: "Llama 3.2 1B",
        description: "Ollama-hosted Llama 3.2 1B",
        tasks: [
          "TextGenerationTask",
          "TextRewriterTask",
          "TextSummaryTask",
          "StructuredGenerationTask",
          "ToolCallingTask",
          "TextEmbeddingTask",
        ],
        provider: OLLAMA as typeof OLLAMA,
        provider_config: { model_name: "llama3.2:1b" },
        metadata: {},
      });
    },
    dispose: async () => {
      await getTaskQueueRegistry().stopQueues();
      await getTaskQueueRegistry().clearQueues();
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
    textGeneration: MODEL_ID,
    toolCalling: MODEL_ID,
    structured: MODEL_ID,
    embeddings: MODEL_ID,
  },
});
