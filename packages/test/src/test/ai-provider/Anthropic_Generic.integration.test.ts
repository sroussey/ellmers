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
import { ANTHROPIC } from "@workglow/anthropic/ai-provider";
import { registerAnthropicInline } from "@workglow/anthropic/ai-provider-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = !!process.env.ANTHROPIC_API_KEY;

const MODEL_ID = "anthropic:claude-haiku";

runGenericAiProviderTests({
  name: "Anthropic",
  skip: !RUN,
  setup: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerAnthropicInline();

    await getGlobalModelRepository().addModel({
      model_id: MODEL_ID,
      title: "Claude Haiku",
      description: "Anthropic Claude Haiku",
      tasks: [
        "TextGenerationTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
      ],
      provider: ANTHROPIC as typeof ANTHROPIC,
      provider_config: { model_name: "claude-haiku-4-5-20251001" },
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
  maxTokens: 100,
  timeout: 30000,
});
