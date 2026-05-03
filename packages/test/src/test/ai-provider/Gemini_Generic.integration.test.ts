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
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY;

const MODEL_ID = "gemini:gemini-2.5-flash";

runGenericAiProviderTests({
  name: "Google Gemini",
  skip: !RUN,
  setup: async () => {
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
  teardown: async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: MODEL_ID,
  toolCallingModel: MODEL_ID,
  structuredGenerationModel: MODEL_ID,
  agentModel: MODEL_ID,
  maxTokens: 200,
  timeout: 30000,
});
