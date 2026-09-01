/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { filterModelSearchResultsByQuery } from "@workglow/ai/provider-utils";
import { TENSORFLOW_MEDIAPIPE } from "./TFMP_Constants";

const TFMP_MODEL_RESULTS: ModelSearchResultItem[] = [
  {
    id: "qwen2.5-1.5b-instruct",
    label: "Qwen2.5 1.5B Instruct",
    description:
      "On-device LLM (int8, ~1.6 GB, Apache-2.0); streaming text generation; requires WebGPU",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Qwen2.5 1.5B Instruct",
      description:
        "Qwen2.5 1.5B instruction-tuned (int8 bundle, Apache-2.0) running locally via MediaPipe LLM inference; requires WebGPU",
      capabilities: [
        "text.generation",
        "json-mode",
        "model.count-tokens",
        "model.download-remove",
        "model.info",
        "model.search",
      ],
      provider_config: {
        model_path:
          "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        task_engine: "genai",
        pipeline: "genai-text",
        max_tokens: 1280,
        chat_template: "chatml",
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
  {
    id: "gemma3-1b-it",
    label: "Gemma 3 1B IT",
    description:
      "On-device LLM (int4, ~0.5 GB); requires WebGPU. Gated: accept the Gemma license on Hugging Face and host the file yourself — anonymous downloads fail",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Gemma 3 1B IT",
      description:
        "Gemma 3 1B instruction-tuned (int4 web bundle) via MediaPipe LLM inference; requires WebGPU. The Hugging Face file is license-gated: accept the Gemma license and replace model_path with a copy you host",
      capabilities: [
        "text.generation",
        "json-mode",
        "model.count-tokens",
        "model.download-remove",
        "model.info",
        "model.search",
      ],
      provider_config: {
        model_path:
          "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4-web.task",
        task_engine: "genai",
        pipeline: "genai-text",
        max_tokens: 1000,
      },
      metadata: {},
    },
    raw: { source: "mediapipe" },
  },
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
    id: "face-detector",
    label: "Face Detector",
    description: "Detects faces with bounding boxes and keypoints",
    record: {
      provider: TENSORFLOW_MEDIAPIPE,
      title: "Face Detector",
      description: "Detects faces with bounding boxes and keypoints",
      capabilities: ["vision.face-detection"],
      provider_config: {
        model_path:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        task_engine: "vision",
        pipeline: "vision-face-detector",
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
): AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> {
  return async (input, _model, _signal, emit) => {
    const results = filterModelSearchResultsByQuery(
      TFMP_MODEL_RESULTS.map((result) => ({
        ...result,
        record: { ...result.record, provider: providerId },
      })),
      input.query
    );
    emit({ type: "finish", data: { results } });
  };
}

export const TFMP_ModelSearch: AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> =
  createTFMPModelSearch(TENSORFLOW_MEDIAPIPE);
