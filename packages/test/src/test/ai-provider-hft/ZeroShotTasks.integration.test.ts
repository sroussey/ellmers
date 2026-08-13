/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Side-effect: registers the image raster codec so the format:"image" input
// resolver can hydrate data URI strings (passed below as TEST_IMAGE_BASE64)
// to GpuImage before the vision tasks see them.
import "@workglow/tasks";

import type { AiJobInput } from "@workglow/ai";
import {
  AiJob,
  getGlobalModelRepository,
  imageClassification,
  InMemoryModelRepository,
  objectDetection,
  setGlobalModelRepository,
  textClassification,
} from "@workglow/ai";
import type { HfTransformersOnnxModelRecord } from "@workglow/huggingface-transformers/ai-runtime";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  HF_TRANSFORMERS_ONNX_CPU,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import {
  ConcurrencyLimiter,
  InMemoryQueueStorage,
  JobQueueClient,
  JobQueueServer,
  wrapQueueStorage,
} from "@workglow/job-queue";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

const TEST_IMAGE_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("Zero-Shot Classification Tasks", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(async () => {
    await setTaskQueueRegistry(null);
    await clearPipelineCache();
  });

  describe("TextClassificationTask - Zero-Shot", () => {
    it("should classify text with zero-shot when candidateLabels are provided", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      await storage.migrate();
      const { messageQueue, jobStore } = wrapQueueStorage(storage);

      // AiJob's execute signature diverges from Job's base; cast is intentional.
      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob as any, {
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
        limiter: new ConcurrencyLimiter(1),
        pollIntervalMs: 1,
      });

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
      });

      client.attach(server);
      await registerHuggingFaceTransformersInline({
        queue: { autoCreate: false },
      });
      queueRegistry.registerQueue({ server, client, storage });

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/mobilebert-uncased-mnli:q8",
        title: "MobileBERT MNLI",
        description: "Zero-shot text classification model",
        capabilities: ["text.classification"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "zero-shot-classification",
          model_path: "Xenova/mobilebert-uncased-mnli",
          dtype: "q8",
        },
        metadata: {},
      };

      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel(model);

      await server.start();

      const result = await textClassification({
        text: "This is a great product!",
        model: model.model_id,
        candidateLabels: ["positive", "negative", "neutral"],
      });

      expect(result).toBeDefined();
      expect(result.categories).toBeDefined();
      expect(Array.isArray(result.categories)).toBe(true);
      expect(result.categories.length).toBeGreaterThan(0);
      expect(result.categories[0]).toHaveProperty("label");
      expect(result.categories[0]).toHaveProperty("score");

      await server.stop();
    }, 30000);
  });

  describe("ImageClassificationTask - Zero-Shot Auto-Selection", () => {
    it("should use regular pipeline when no categories provided", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      await storage.migrate();
      const { messageQueue, jobStore } = wrapQueueStorage(storage);

      // AiJob's execute signature diverges from Job's base; cast is intentional.
      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob as any, {
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
        limiter: new ConcurrencyLimiter(1),
        pollIntervalMs: 1,
      });

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
      });

      client.attach(server);
      await registerHuggingFaceTransformersInline({
        queue: { autoCreate: false },
      });
      queueRegistry.registerQueue({ server, client, storage });

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/vit-base-patch16-224:q8",
        title: "ViT Base Patch16 224",
        description: "Image classification model",
        capabilities: ["image.classification"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "image-classification",
          model_path: "Xenova/vit-base-patch16-224",
          dtype: "q8",
        },
        metadata: {},
      };

      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel(model);

      await server.start();

      const result = await imageClassification({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        maxCategories: 3,
      });

      expect(result).toBeDefined();
      expect(result.categories).toBeDefined();
      expect(Array.isArray(result.categories)).toBe(true);

      await server.stop();
    }, 30000);

    it("should use zero-shot pipeline when categories are provided", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      await storage.migrate();
      const { messageQueue, jobStore } = wrapQueueStorage(storage);

      // AiJob's execute signature diverges from Job's base; cast is intentional.
      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob as any, {
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
        limiter: new ConcurrencyLimiter(1),
        pollIntervalMs: 1,
      });

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
      });

      client.attach(server);
      await registerHuggingFaceTransformersInline({
        queue: { autoCreate: false },
      });
      queueRegistry.registerQueue({ server, client, storage });

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/clip-vit-base-patch32:q8",
        title: "CLIP ViT Base Patch32",
        description: "Zero-shot image classification model",
        capabilities: ["image.classification"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "zero-shot-image-classification",
          model_path: "Xenova/clip-vit-base-patch32",
          dtype: "q8",
        },
        metadata: {},
      };

      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel(model);

      await server.start();

      const result = await imageClassification({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        categories: ["cat", "dog", "bird", "car"],
      });

      expect(result).toBeDefined();
      expect(result.categories).toBeDefined();
      const categories = Array.isArray(result.categories[0])
        ? result.categories[0]
        : result.categories;
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
      // All provided categories should be in the results
      const labels = categories.map((c: any) => c.label);
      expect(labels).toContain("cat");
      expect(labels).toContain("dog");

      await server.stop();
    }, 30000);
  });

  describe("ObjectDetectionTask - Zero-Shot", () => {
    it("should detect objects with zero-shot when labels are provided", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      await storage.migrate();
      const { messageQueue, jobStore } = wrapQueueStorage(storage);

      // AiJob's execute signature diverges from Job's base; cast is intentional.
      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob as any, {
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
        limiter: new ConcurrencyLimiter(1),
        pollIntervalMs: 1,
      });

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        messageQueue,
        jobStore,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
      });

      client.attach(server);
      await registerHuggingFaceTransformersInline({
        queue: { autoCreate: false },
      });
      queueRegistry.registerQueue({ server, client, storage });

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/owlvit-base-patch32:q8",
        title: "OWL-ViT Base Patch32",
        description: "Zero-shot object detection model",
        capabilities: ["image.object-detection"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "zero-shot-object-detection",
          model_path: "Xenova/owlvit-base-patch32",
          dtype: "q8",
        },
        metadata: {},
      };

      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel(model);

      await server.start();

      const result = await objectDetection({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        labels: ["person", "car", "dog"],
        threshold: 0.1,
      });

      expect(result).toBeDefined();
      expect(result.detections).toBeDefined();
      const detections = Array.isArray(result.detections[0])
        ? result.detections[0]
        : result.detections;
      expect(Array.isArray(detections)).toBe(true);
      if (detections.length > 0) {
        const detection = detections[0] as any;
        expect(detection).toHaveProperty("label");
        expect(detection).toHaveProperty("score");
        expect(detection).toHaveProperty("box");
        expect(detection.box).toHaveProperty("x");
        expect(detection.box).toHaveProperty("y");
        expect(detection.box).toHaveProperty("width");
        expect(detection.box).toHaveProperty("height");
      }

      await server.stop();
    }, 30000);
  });
});
