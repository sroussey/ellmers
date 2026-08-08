/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration tests for the LOCAL_LLAMACPP provider using real GGUF models.
 *
 * These tests download small GGUF models from HuggingFace, generate text, and
 * compute embeddings. They require node-llama-cpp to be installed and a working
 * internet connection for the first run. Downloaded models are cached on disk,
 * so subsequent runs do not re-download.
 *
 * Models used (chosen for minimal size):
 *   - Text generation: SmolLM2 135M Instruct Q4_K_M  (~85 MB)
 *   - Embedding:       BGE Small EN v1.5 Q8_0         (~34 MB)
 */

import type { TextEmbeddingTaskOutput, TextGenerationTaskOutput } from "@workglow/ai";
import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai";
import { LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai";
import {
  disposeLlamaCppResources,
  registerLlamaCppInline,
} from "@workglow/node-llama-cpp/ai-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { ResourceScope, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { report, snap } from "../../binding/testTiming";

// ========================================================================
// Model definitions (tiny models suitable for testing)
// ========================================================================

const LLM_MODEL_ID = "llamacpp:SmolLM2-135M-Instruct:Q4_K_M";
const LLM_MODEL_URL = "hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M";

const llmModel: LlamaCppModelRecord = {
  model_id: LLM_MODEL_ID,
  title: "SmolLM2 135M Instruct",
  description: "A 135M parameter instruction-following model, quantized Q4_K_M (~85 MB)",
  capabilities: ["text.generation", "text.rewriter", "text.summary"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/SmolLM2-135M-Instruct-Q4_K_M.gguf",
    model_url: LLM_MODEL_URL,
    models_dir: "./models",
    context_size: 512,
    flash_attention: false,
  },
  metadata: {},
};

const EMBED_MODEL_ID = "llamacpp:bge-small-en-v1.5:Q8_0";
const EMBED_MODEL_URL = "hf:CompendiumLabs/bge-small-en-v1.5-gguf:Q8_0";

const embeddingModel: LlamaCppModelRecord = {
  model_id: EMBED_MODEL_ID,
  title: "BGE Small EN v1.5",
  description: "A small English text embedding model, quantized Q8_0 (~34 MB)",
  capabilities: ["text.embedding"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/bge-small-en-v1.5-Q8_0.gguf",
    model_url: EMBED_MODEL_URL,
    models_dir: "./models",
    embedding: true,
  },
  metadata: {},
};

// ========================================================================
// Suite setup
// ========================================================================

describe("LlamaCpp Integration (real models, no mocks)", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  // Initialized synchronously up front so `afterAll` always has a scope to
  // dispose, even if the async setup below throws partway through.
  const resourceScope = new ResourceScope();

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());

    await registerLlamaCppInline();

    const repo = getGlobalModelRepository();
    await repo.addModel(llmModel);
    await repo.addModel(embeddingModel);
  });

  afterAll(async () => {
    const s = snap();
    await resourceScope.disposeAll();
    await disposeLlamaCppResources();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
    report("LlamaCpp dispose", s);
  });

  // ======================================================================
  // Text generation model: download → generate story
  // ======================================================================

  it(
    "downloads a text generation model and generates a short story",
    async () => {
      const s = snap();
      // Step 1 — download the LLM
      const downloadWorkflow = new Workflow();
      downloadWorkflow.downloadModel({ model: LLM_MODEL_ID });
      await downloadWorkflow.run({}, { resourceScope });

      // Step 2 — generate a story
      const storyWorkflow = new Workflow();
      storyWorkflow.textGeneration({
        model: LLM_MODEL_ID,
        prompt: "Write a very short story about a curious robot who discovers a garden.",
        maxTokens: 120,
        temperature: 0.7,
      });

      const storyResult = (await storyWorkflow.run(
        {},
        { resourceScope }
      )) as TextGenerationTaskOutput;

      expect(storyResult.text).toBeDefined();
      expect(typeof storyResult.text).toBe("string");
      expect((storyResult.text as string).trim().length).toBeGreaterThan(10);
      report("llm download+generate", s);
    },
    10 * 60 * 1000 // 10 min: download (~85 MB) + inference
  );

  // ======================================================================
  // Embedding model: download → embed the story sentences
  // ======================================================================

  it(
    "downloads an embedding model and embeds text",
    async () => {
      const s = snap();
      // Step 1 — download the embedding model
      const downloadWorkflow = new Workflow();
      downloadWorkflow.downloadModel({ model: EMBED_MODEL_ID });
      await downloadWorkflow.run({}, { resourceScope });

      // Step 2 — embed a sentence
      const sentence = "A curious robot wandered into an overgrown garden.";
      const embedWorkflow = new Workflow();
      embedWorkflow.textEmbedding({
        model: EMBED_MODEL_ID,
        text: sentence,
      });

      const embedResult = (await embedWorkflow.run(
        {},
        { resourceScope }
      )) as TextEmbeddingTaskOutput;

      expect(embedResult.vector).toBeDefined();
      expect(embedResult.vector).toBeInstanceOf(Float32Array);

      const vector = embedResult.vector as Float32Array;
      expect(vector.length).toBeGreaterThan(0);

      // Vector should not be all zeros
      const magnitude = Array.from(vector).reduce((sum, v) => sum + v * v, 0);
      expect(magnitude).toBeGreaterThan(0);
      report("embed download+embed", s);
    },
    10 * 60 * 1000 // 10 min: download (~34 MB) + inference
  );

  // ======================================================================
  // End-to-end: generate a story and embed its sentences
  // ======================================================================

  it(
    "generates a story and computes embeddings for each sentence",
    async () => {
      const s = snap();
      // Both models already downloaded by the previous tests; this verifies
      // the full pipeline works end-to-end using cached models.

      const storyWorkflow = new Workflow();
      storyWorkflow.textGeneration({
        model: LLM_MODEL_ID,
        prompt: "In two sentences, describe what a robot would think about on a rainy day.",
        maxTokens: 80,
        temperature: 0.5,
      });
      const storyResult = (await storyWorkflow.run(
        {},
        { resourceScope }
      )) as TextGenerationTaskOutput;
      const story = (storyResult.text as string)?.trim() ?? "";

      expect(story.length).toBeGreaterThan(5);

      // Split into sentences and embed each one
      const sentences = story
        .split(/(?<=[.!?])\s+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      const embedWorkflow = new Workflow();
      embedWorkflow.textEmbedding({
        model: EMBED_MODEL_ID,
        text: sentences.length === 1 ? sentences[0] : sentences,
      });

      const embedResult = (await embedWorkflow.run(
        {},
        { resourceScope }
      )) as TextEmbeddingTaskOutput;

      if (sentences.length === 1) {
        expect(embedResult.vector).toBeInstanceOf(Float32Array);
        expect((embedResult.vector as Float32Array).length).toBeGreaterThan(0);
      } else {
        expect(Array.isArray(embedResult.vector)).toBe(true);
        const vectors = embedResult.vector as Float32Array[];
        expect(vectors.length).toBe(sentences.length);
        for (const v of vectors) {
          expect(v).toBeInstanceOf(Float32Array);
          expect(v.length).toBeGreaterThan(0);
        }
      }
      report("end-to-end", s);
    },
    5 * 60 * 1000 // 5 min: inference only (models already cached)
  );
});
