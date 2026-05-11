/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { filterModelSearchResultsByQuery } from "@workglow/ai/provider-utils";
import type { StreamEvent } from "@workglow/task-graph";
import { TENSORFLOW_MEDIAPIPE } from "./TFMP_Constants";

const TFMP_MODEL_RESULTS: ModelSearchResultItem[] = [
  {
    id: "universal-sentence-encoder",
    label: "Universal Sentence Encoder",
    description: "Text embedding model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Universal Sentence Encoder",
      description: "Universal Sentence Encoder",
      capabilities: ["text.embedding"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
        task_engine: "text",
        pipeline: "text-embedder",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "language-detector",
    label: "MediaPipe Language Detector",
    description: "Language detection model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "MediaPipe Language Detector",
      description: "MediaPipe Language Detector",
      capabilities: ["text.language-detection"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/language_detector/language_detector/float32/latest/language_detector.tflite",
        task_engine: "text",
        pipeline: "text-language-detector",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "bert-text-classifier",
    label: "MediaPipe BERT Text Classifier",
    description: "Text classification model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "MediaPipe BERT Text Classifier",
      description: "MediaPipe BERT Text Classifier",
      capabilities: ["text.classification"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-tasks/text_classifier/bert_text_classifier.tflite",
        task_engine: "text",
        pipeline: "text-classifier",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "image-embedder",
    label: "MediaPipe Image Embedder",
    description: "Image embedding model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "MediaPipe Image Embedder",
      description: "MediaPipe Image Embedder",
      capabilities: ["image.embedding"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite",
        task_engine: "vision",
        pipeline: "vision-image-embedder",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "efficientnet-lite0",
    label: "EfficientNet Lite0",
    description: "Image classification model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "EfficientNet Lite0",
      description: "Image classification model",
      capabilities: ["image.classification"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite",
        task_engine: "vision",
        pipeline: "vision-image-classifier",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "efficientdet-lite0",
    label: "Efficient Object Detector Lite0",
    description: "Object detection model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Efficient Object Detector Lite0",
      description: "Object detection model",
      capabilities: ["image.object-detection"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite",
        task_engine: "vision",
        pipeline: "vision-object-detector",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "deeplabv3",
    label: "Efficient Image Segmenter Lite0",
    description: "Image segmentation model",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Efficient Image Segmenter Lite0",
      description: "Image segmentation model",
      capabilities: ["image.segmentation"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-assets/deeplabv3.tflite?generation=1661875711618421",
        task_engine: "vision",
        pipeline: "vision-image-segmenter",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "face-landmarker",
    label: "Face Landmarker",
    description: "Detects 478 facial landmarks with blendshapes",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Face Landmarker",
      description: "Detects 478 facial landmarks with blendshapes",
      capabilities: ["vision.face-landmarks"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        task_engine: "vision",
        pipeline: "vision-face-landmarker",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "gesture-recognizer",
    label: "Gesture Recognizer",
    description: "Recognizes hand gestures such as thumbs up and victory",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Gesture Recognizer",
      description: "Recognizes hand gestures such as thumbs up and victory",
      capabilities: ["vision.gesture"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
        task_engine: "vision",
        pipeline: "vision-gesture-recognizer",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "hand-landmarker",
    label: "Hand Landmarker",
    description: "Detects 21 hand landmarks",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Hand Landmarker",
      description: "Detects 21 hand landmarks",
      capabilities: ["vision.hand-landmarks"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        task_engine: "vision",
        pipeline: "vision-hand-landmarker",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "pose-landmarker",
    label: "Pose Landmarker",
    description: "Detects 33 body pose landmarks",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Pose Landmarker",
      description: "Detects 33 body pose landmarks",
      capabilities: ["vision.pose-landmarks"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        task_engine: "vision",
        pipeline: "vision-pose-landmarker",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
];

export function createTFMPModelSearch(
  providerId: string
): AiProviderStreamFn<ModelSearchTaskInput, ModelSearchTaskOutput> {
  return async function* (input): AsyncIterable<StreamEvent<ModelSearchTaskOutput>> {
    const results = filterModelSearchResultsByQuery(
      TFMP_MODEL_RESULTS.map((result) => ({
        ...result,
        record: { ...result.record, provider: providerId },
      })),
      input.query
    );
    yield { type: "finish", data: { results } };
  };
}

export const TFMP_ModelSearch: AiProviderStreamFn<ModelSearchTaskInput, ModelSearchTaskOutput> =
  createTFMPModelSearch(TENSORFLOW_MEDIAPIPE);
