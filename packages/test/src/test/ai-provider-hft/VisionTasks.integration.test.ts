/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Side-effect: registers the image raster codec, GpuImage factory, and image
// input resolver so AiVisionTask can hydrate data URIs to GpuImage.
import "@workglow/tasks";

import {
  getGlobalModelRepository,
  imageClassification,
  imageEmbedding,
  imageSegmentation,
  imageToText,
  InMemoryModelRepository,
  objectDetection,
  setGlobalModelRepository,
} from "@workglow/ai";
import type { HfTransformersOnnxModelRecord } from "@workglow/huggingface-transformers/ai-runtime";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { isImageValue } from "@workglow/util/media";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Test image (1x1 pixel red PNG, base64 encoded)
const TEST_IMAGE_BASE64 =
  "data:image/jpeg;base64,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";

describe("Vision Tasks - HuggingFace Transformers", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(async () => {
    await setTaskQueueRegistry(null);
    await clearPipelineCache();
    await registerHuggingFaceTransformersInline();
    setGlobalModelRepository(new InMemoryModelRepository());
  });
  afterEach(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  describe("ImageSegmentationTask", () => {
    it("should segment an image using HFT", async () => {
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:jonathandinu/face-parsing",
        title: "Face Parsing",
        description: "Face parsing image segmentation model",
        capabilities: ["image.segmentation"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "image-segmentation",
          model_path: "jonathandinu/face-parsing",
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      const result = await imageSegmentation({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
      });

      expect(result).toBeDefined();
      expect(result.masks).toBeDefined();
      expect(Array.isArray(result.masks)).toBe(true);
      type SegmentationMask = {
        readonly label: string;
        readonly score: number;
        readonly mask: unknown;
      };

      const masksArray: readonly SegmentationMask[] = result.masks as readonly SegmentationMask[];
      expect(masksArray.length).toBeGreaterThan(0);
      for (const item of masksArray) {
        expect(isImageValue(item.mask)).toBe(true);
        expect((item.mask as { readonly width: number }).width).toBeGreaterThan(0);
        expect((item.mask as { readonly height: number }).height).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe("ImageClassificationTask", () => {
    it("should classify an image using HFT", async () => {
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

      await getGlobalModelRepository().addModel(model);

      const result = await imageClassification({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        maxCategories: 5,
      });

      expect(result).toBeDefined();
      expect(result.categories).toBeDefined();
      expect(Array.isArray(result.categories)).toBe(true);
      if (result.categories.length > 0) {
        expect(result.categories[0]).toHaveProperty("label");
        expect(result.categories[0]).toHaveProperty("score");
      }
    }, 30000);

    it("should use zero-shot classification when categories are provided", async () => {
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

      await getGlobalModelRepository().addModel(model);

      const result = await imageClassification({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        categories: ["cat", "dog", "bird"],
      });

      expect(result).toBeDefined();
      expect(result.categories).toBeDefined();
      expect(Array.isArray(result.categories)).toBe(true);
      expect(result.categories.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe("ImageEmbeddingTask", () => {
    it("should generate image embeddings using HFT", async () => {
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/clip-vit-base-patch32:q8",
        title: "CLIP ViT Base Patch32",
        description: "Image embedding model",
        capabilities: ["image.embedding"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "image-feature-extraction",
          model_path: "Xenova/clip-vit-base-patch32",
          dtype: "q8",
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      const result = await imageEmbedding({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
      });

      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector.length).toBeGreaterThan(0);
    }, 30000);

    it("should generate image embeddings for an array of images using HFT", async () => {
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/clip-vit-base-patch32:q8",
        title: "CLIP ViT Base Patch32",
        description: "Image embedding model",
        capabilities: ["image.embedding"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "image-feature-extraction",
          model_path: "Xenova/clip-vit-base-patch32",
          dtype: "q8",
        },
        metadata: {},
      };
      await getGlobalModelRepository().addModel(model);

      const images = [TEST_IMAGE_BASE64, TEST_IMAGE_BASE64];

      const result = await imageEmbedding({
        image: images as never,
        model: "onnx:Xenova/clip-vit-base-patch32:q8",
      });

      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      expect(Array.isArray(result.vector)).toBe(true);
      const vectors = result.vector as Float32Array[];
      expect(vectors).toHaveLength(images.length);
      for (const v of vectors) {
        expect(v).toBeInstanceOf(Float32Array);
        expect(v.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe("ObjectDetectionTask", () => {
    it("should detect objects using HFT", async () => {
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/detr-resnet-50:q8",
        title: "DETR ResNet-50",
        description: "Object detection model",
        capabilities: ["image.object-detection"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "object-detection",
          model_path: "Xenova/detr-resnet-50",
          dtype: "q8",
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      const result = await objectDetection({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        threshold: 0.5,
      });

      expect(result).toBeDefined();
      expect(result.detections).toBeDefined();
      expect(Array.isArray(result.detections)).toBe(true);
    }, 30000);
  });

  describe("ImageToTextTask", () => {
    it("should generate text from image using HFT", async () => {
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/vit-gpt2-image-captioning:q8",
        title: "ViT GPT2 Image Captioning",
        description: "Image to text model",
        capabilities: ["image.to-text"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "image-to-text",
          model_path: "Xenova/vit-gpt2-image-captioning",
          dtype: "q8",
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      const result = await imageToText({
        image: TEST_IMAGE_BASE64 as never,
        model: model.model_id,
        maxTokens: 50,
      });

      expect(result).toBeDefined();
      expect(result.text).toBeDefined();
      expect(typeof result.text).toBe("string");
    }, 30000);
  });
});
