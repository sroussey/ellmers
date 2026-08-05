/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextEmbeddingTaskOutput } from "@workglow/ai";
import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  ModelDownloadTask,
  setGlobalModelRepository,
} from "@workglow/ai";
import type { HfTransformersOnnxModelRecord } from "@workglow/huggingface-transformers/ai-runtime";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
// import { TFMP_TASKS } from "@workglow/tf-mediapipe/ai";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getTestingLogger } from "../../binding/TestingLogger";

describe("TextEmbeddingTask with real models", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await clearPipelineCache();
    await registerHuggingFaceTransformersInline();
  });

  afterAll(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  beforeEach(() => {});

  describe("HuggingFace Transformers", () => {
    it("should generate embeddings with gte-small model", async () => {
      // Register model
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/gte-small:q8",
        title: "gte-small",
        description: "Xenova/gte-small quantized to 8bit",
        capabilities: ["text.embedding"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Xenova/gte-small",
          dtype: "q8",
          native_dimensions: 384,
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      // First download the model
      const download = new ModelDownloadTask({
        defaults: { model: "onnx:Xenova/gte-small:q8" },
      });
      let lastProgress: number | undefined = -1;
      download.on("progress", (progress, message, details) => {
        if (progress !== lastProgress) {
          logger.info(
            `Overall: ${progress}% | File: ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
          );
          lastProgress = progress;
        }
      });

      await download.run();

      const embeddingWorkflow = new Workflow();
      embeddingWorkflow.textEmbedding({
        model: "onnx:Xenova/gte-small:q8",
        text: "The quick brown fox jumps over the lazy dog",
      });

      const result = (await embeddingWorkflow.run()) as TextEmbeddingTaskOutput;

      // Validate result
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      const vector = result.vector as Float32Array | number[];
      expect(Array.isArray(vector) || vector instanceof Float32Array).toBe(true);
      expect(vector.length).toBe(384);

      // Verify the vector has meaningful values (not all zeros)
      const vectorSum = Array.from(vector).reduce((sum, val) => sum + Math.abs(val as number), 0);
      expect(vectorSum).toBeGreaterThan(0);
    }, 120000); // 2 minute timeout for model download

    it("should generate embeddings with bge-base-en-v1.5 model", async () => {
      // Register model
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/bge-base-en-v1.5:q8",
        title: "bge-base-en-v1.5",
        description: "Xenova/bge-base-en-v1.5 quantized to 8bit",
        capabilities: ["text.embedding"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Xenova/bge-base-en-v1.5",
          dtype: "q8",
          native_dimensions: 768,
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      // Download the model
      const downloadWorkflow = new Workflow();
      downloadWorkflow.downloadModel({
        model: "onnx:Xenova/bge-base-en-v1.5:q8",
      });
      await downloadWorkflow.run();

      // Test embeddings
      const embeddingWorkflow = new Workflow();
      embeddingWorkflow.textEmbedding({
        model: "onnx:Xenova/bge-base-en-v1.5:q8",
        text: "Machine learning is a subset of artificial intelligence",
      });

      const result = (await embeddingWorkflow.run()) as TextEmbeddingTaskOutput;

      // Validate result
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      const vector = result.vector as Float32Array | number[];
      expect(Array.isArray(vector) || vector instanceof Float32Array).toBe(true);
      expect(vector.length).toBe(768);

      // Verify the vector has meaningful values
      const vectorSum = Array.from(vector).reduce((sum, val) => sum + Math.abs(val as number), 0);
      expect(vectorSum).toBeGreaterThan(0);
    }, 120000);

    it("should generate embeddings for a direct array of texts (batch)", async () => {
      // Reuses the gte-small model registered and downloaded by the first test
      const texts = [
        "The quick brown fox jumps over the lazy dog",
        "Machine learning is a subset of artificial intelligence",
        "Embeddings capture semantic meaning of text",
      ];

      const embeddingWorkflow = new Workflow();
      embeddingWorkflow.textEmbedding({
        model: "onnx:Xenova/gte-small:q8",
        text: texts,
      });

      const result = (await embeddingWorkflow.run()) as TextEmbeddingTaskOutput;

      // Should produce an array of embeddings (one per input text)
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      expect(Array.isArray(result.vector)).toBe(true);
      const vectors = result.vector as Float32Array[];
      expect(vectors).toHaveLength(texts.length);

      // Each embedding should be the correct dimension and non-trivial
      for (let i = 0; i < texts.length; i++) {
        const vector = vectors[i];
        expect(vector instanceof Float32Array).toBe(true);
        expect(vector.length).toBe(384);

        const vectorSum = Array.from(vector).reduce((sum, val) => sum + Math.abs(val), 0);
        expect(vectorSum).toBeGreaterThan(0);
      }

      // Verify different texts produce different embeddings
      const v0 = Array.from(vectors[0]);
      const v1 = Array.from(vectors[1]);
      const diff = v0.reduce((sum, val, i) => sum + Math.abs(val - v1[i]), 0);
      expect(diff).toBeGreaterThan(0);
    }, 120000);

    it("should generate embeddings for an array of texts using map", async () => {
      // Reuses the gte-small model registered and downloaded by the first test
      const texts = [
        "The quick brown fox jumps over the lazy dog",
        "Machine learning is a subset of artificial intelligence",
        "Embeddings capture semantic meaning of text",
      ];

      const workflow = new Workflow();
      workflow
        .map({ maxIterations: 5 })
        .textEmbedding({ model: "onnx:Xenova/gte-small:q8" })
        .endMap();

      const result = (await workflow.run({ text: texts })) as {
        vector: readonly (Float32Array | number[])[];
      };

      // Should produce one embedding per input text
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      expect(result.vector).toHaveLength(texts.length);

      // Each embedding should be the correct dimension and non-trivial
      for (let i = 0; i < texts.length; i++) {
        const vector = result.vector[i];
        expect(Array.isArray(vector) || vector instanceof Float32Array).toBe(true);
        expect(vector.length).toBe(384);

        const vectorSum = Array.from(vector).reduce((sum, val) => sum + Math.abs(val as number), 0);
        expect(vectorSum).toBeGreaterThan(0);
      }

      // Verify different texts produce different embeddings
      const v0 = Array.from(result.vector[0]);
      const v1 = Array.from(result.vector[1]);
      const diff = v0.reduce((sum, val, i) => sum + Math.abs(val - (v1[i] as number)), 0);
      expect(diff).toBeGreaterThan(0);
    }, 120000);
  });
});
