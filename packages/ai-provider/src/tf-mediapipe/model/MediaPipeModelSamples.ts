import { ModelUseCaseEnum } from "ellmers-ai";
import { MediaPipeTfJsModel } from "./MediaPipeModel";

export const universal_sentence_encoder = new MediaPipeTfJsModel(
  "Universal Sentence Encoder",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
  { dimensions: 100, browserOnly: true }
);

export const kerasSdTextEncoder = new MediaPipeTfJsModel(
  "keras-sd/text-encoder-tflite",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "https://huggingface.co/keras-sd/text-encoder-tflite/resolve/main/text_encoder.tflite?download=true",
  { dimensions: 100, browserOnly: true }
);
