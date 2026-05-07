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
import { ANTHROPIC, registerAnthropic } from "@workglow/anthropic/ai-provider";
import { registerAnthropicInline } from "@workglow/anthropic/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.ANTHROPIC_API_KEY;
const MODEL_ID = "anthropic:claude-haiku";

runAiProviderConformance({
  name: "Anthropic (inline)",
  skip: !RUN,
  timeout: 30_000,
  factory: async () => ({
    register: async () => {
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
    dispose: async () => {
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({}),
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
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

const anthropicWorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerAnthropic({
      worker: () =>
        new Worker(new URL("./worker_anthropic_test.ts", import.meta.url), { type: "module" }),
    });
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
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "Anthropic (worker)",
  skip: !RUN,
  timeout: 60_000,
  factory: anthropicWorkerFactory,
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
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

runWorkerProxyBoundary({
  name: "Anthropic",
  skip: !RUN,
  timeout: 60_000,
  factory: anthropicWorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: MODEL_ID, toolCalling: MODEL_ID },
});
