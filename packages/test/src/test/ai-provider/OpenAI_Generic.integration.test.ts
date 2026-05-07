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
import { OPENAI, registerOpenAi } from "@workglow/openai/ai-provider";
import { registerOpenAiInline } from "@workglow/openai/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.OPENAI_API_KEY;
const MODEL_ID = "openai:gpt-4o-mini";
const EMBED_MODEL_ID = "openai:text-embedding-3-small";

runAiProviderConformance({
  name: "OpenAI (inline)",
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
      await getGlobalModelRepository().addModel({
        model_id: EMBED_MODEL_ID,
        title: "Text Embedding 3 Small",
        description: "OpenAI text-embedding-3-small (1536D)",
        tasks: ["TextEmbeddingTask"],
        provider: OPENAI as typeof OPENAI,
        provider_config: { model_name: "text-embedding-3-small" },
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
    embeddings: EMBED_MODEL_ID,
  },
});

const openaiWorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerOpenAi({
      worker: () =>
        new Worker(new URL("./worker_openai_test.ts", import.meta.url), { type: "module" }),
    });
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
    await getGlobalModelRepository().addModel({
      model_id: EMBED_MODEL_ID,
      title: "Text Embedding 3 Small",
      description: "OpenAI text-embedding-3-small (1536D)",
      tasks: ["TextEmbeddingTask"],
      provider: OPENAI as typeof OPENAI,
      provider_config: { model_name: "text-embedding-3-small" },
      metadata: {},
    });
  },
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "OpenAI (worker)",
  skip: !RUN,
  timeout: 60_000,
  factory: openaiWorkerFactory,
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
    embeddings: EMBED_MODEL_ID,
  },
});

runWorkerProxyBoundary({
  name: "OpenAI",
  skip: !RUN,
  timeout: 60_000,
  factory: openaiWorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: MODEL_ID, toolCalling: MODEL_ID },
});
