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
import { OPENAI } from "@workglow/openai/ai-provider";
import { registerOpenAiInline } from "@workglow/openai/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.OPENAI_API_KEY;
const MODEL_ID = "openai:gpt-4o-mini";

runAiProviderConformance({
  name: "OpenAI",
  skip: !RUN,
  timeout: 30_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerOpenAiInline();
      await getGlobalModelRepository().addModel({
        model_id: MODEL_ID,
        title: "GPT-4o Mini",
        description: "OpenAI GPT-4o Mini",
        tasks: [
          "TextGenerationTask",
          "TextRewriterTask",
          "TextSummaryTask",
          "StructuredGenerationTask",
          "ToolCallingTask",
        ],
        provider: OPENAI as typeof OPENAI,
        provider_config: { model_name: "gpt-4o-mini" },
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
    structured: true,
    // Embeddings would require registering a separate embedding model
    // (e.g. text-embedding-3-small) — defer to a dedicated suite. The
    // chat model wired up here (gpt-4o-mini) does not advertise
    // TextEmbeddingTask, so claiming embeddings=true was dishonest.
    embeddings: false,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: MODEL_ID,
    toolCalling: MODEL_ID,
    structured: MODEL_ID,
  },
});
