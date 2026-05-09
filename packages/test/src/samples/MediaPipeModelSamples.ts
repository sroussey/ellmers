import { getGlobalModelRepository } from "@workglow/ai";
import { TENSORFLOW_MEDIAPIPE } from "@workglow/tf-mediapipe/ai";
import type { TFMPModelRecord } from "@workglow/tf-mediapipe/ai";

export async function registerMediaPipeTfJsLocalModels(): Promise<void> {
  const models: TFMPModelRecord[] = [
    // Text Models
    {
      model_id: "media-pipe:Universal Sentence Encoder",
      title: "Universal Sentence Encoder",
      description: "Universal Sentence Encoder",
      capabilities: ["text.embedding"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "text",
        pipeline: "text-embedder",
        model_path:
          "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:BERT Text Classifier",
      title: "BERT Text Classifier",
      description: "BERT-based text classification model",
      capabilities: ["text.classification"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "text",
        pipeline: "text-classifier",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/text_classifier/bert_classifier/float32/1/bert_classifier.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:Language Detector",
      title: "Language Detector",
      description: "Language detection model",
      capabilities: ["text.language-detection"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "text",
        pipeline: "text-language-detector",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/language_detector/language_detector/float32/1/language_detector.tflite",
      },
      metadata: {},
    },
    // Vision Models
    {
      model_id: "media-pipe:EfficientNet Lite0 Image Classifier",
      title: "EfficientNet Lite0",
      description: "Lightweight image classification model",
      capabilities: ["image.classification"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-image-classifier",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:MobileNet V3 Image Embedder",
      title: "MobileNet V3 Small",
      description: "Lightweight image embedding model",
      capabilities: ["image.embedding"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-image-embedder",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:EfficientDet Lite0 Object Detector",
      title: "EfficientDet Lite0",
      description: "Lightweight object detection model",
      capabilities: ["image.object-detection"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-object-detector",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:DeepLab V3 Image Segmenter",
      title: "DeepLab V3",
      description: "Image segmentation model",
      capabilities: ["image.segmentation"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-image-segmenter",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite",
      },
      metadata: {},
    },
    // Audio Models
    {
      model_id: "media-pipe:YAMNet Audio Classifier",
      title: "YAMNet",
      description: "Audio event classification model",
      capabilities: ["audio.classification"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "audio",
        pipeline: "audio-classifier",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:Gesture Recognizer",
      title: "Gesture Recognizer",
      description: "Recognizes hand gestures (thumbs up, victory, etc.)",
      capabilities: ["vision.gesture"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-gesture-recognizer",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:Hand Landmarker",
      title: "Hand Landmarker",
      description: "Detects 21 hand landmarks",
      capabilities: ["vision.hand-landmarks"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-hand-landmarker",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:Face Detector",
      title: "Face Detector",
      description: "Detects faces with bounding boxes and keypoints",
      capabilities: ["vision.face-detection"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-face-detector",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:Face Landmarker",
      title: "Face Landmarker",
      description: "Detects 478 facial landmarks with blendshapes",
      capabilities: ["vision.face-landmarks"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-face-landmarker",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      },
      metadata: {},
    },
    {
      model_id: "media-pipe:Pose Landmarker",
      title: "Pose Landmarker",
      description: "Detects 33 body pose landmarks",
      capabilities: ["vision.pose-landmarks"],
      provider: TENSORFLOW_MEDIAPIPE,
      provider_config: {
        task_engine: "vision",
        pipeline: "vision-pose-landmarker",
        model_path:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      },
      metadata: {},
    },
  ];

  for (const model of models) {
    await getGlobalModelRepository().addModel(model);
  }
}
