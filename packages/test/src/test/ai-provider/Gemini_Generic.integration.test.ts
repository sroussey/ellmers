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
import { GOOGLE_GEMINI } from "@workglow/google-gemini/ai-provider";
import { registerGeminiInline } from "@workglow/google-gemini/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY;
const MODEL_ID = "gemini:gemini-2.5-flash";

runAiProviderConformance({
  name: "Google Gemini",
  skip: !RUN,
  timeout: 30_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerGeminiInline();
      await getGlobalModelRepository().addModel({
        model_id: MODEL_ID,
        title: "Gemini 2.5 Flash",
        description: "Google Gemini 2.5 Flash",
        tasks: [
          "TextGenerationTask",
          "TextRewriterTask",
          "TextSummaryTask",
          "StructuredGenerationTask",
          "ToolCallingTask",
        ],
        provider: GOOGLE_GEMINI as typeof GOOGLE_GEMINI,
        provider_config: { model_name: "gemini-2.5-flash" },
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
    embeddings: true,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: MODEL_ID,
    toolCalling: MODEL_ID,
    structured: MODEL_ID,
  },
});
