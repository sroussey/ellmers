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
import { GOOGLE_GEMINI, registerGemini } from "@workglow/google-gemini/ai-provider";
import { registerGeminiInline } from "@workglow/google-gemini/ai-provider-runtime";
import { setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY;
const MODEL_ID = "gemini:gemini-2.5-flash";
const EMBED_MODEL_ID = "gemini:gemini-embedding-001";

runAiProviderConformance({
  name: "Google Gemini (inline)",
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
      await getGlobalModelRepository().addModel({
        model_id: EMBED_MODEL_ID,
        title: "Gemini Embedding 001",
        description: "Google Gemini embedding model",
        tasks: ["TextEmbeddingTask"],
        provider: GOOGLE_GEMINI as typeof GOOGLE_GEMINI,
        provider_config: { model_name: "gemini-embedding-001" },
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

const geminiWorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerGemini({
      worker: () =>
        new Worker(new URL("./worker_gemini_test.ts", import.meta.url), { type: "module" }),
    });
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
    await getGlobalModelRepository().addModel({
      model_id: EMBED_MODEL_ID,
      title: "Gemini Embedding 001",
      description: "Google Gemini embedding model",
      tasks: ["TextEmbeddingTask"],
      provider: GOOGLE_GEMINI as typeof GOOGLE_GEMINI,
      provider_config: { model_name: "gemini-embedding-001" },
      metadata: {},
    });
  },
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "Google Gemini (worker)",
  skip: !RUN,
  timeout: 60_000,
  factory: geminiWorkerFactory,
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
  name: "Google Gemini",
  skip: !RUN,
  timeout: 60_000,
  factory: geminiWorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: MODEL_ID, toolCalling: MODEL_ID },
});
