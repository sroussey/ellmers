//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

// import { GgmlLocalModel } from "../model/GgmlLocalModel";
import { ONNXTransformerJsModel } from "../model/HuggingFaceModel";
import { MediaPipeTfJsModel } from "../model/MediaPipeModel";
import { Model, ModelUseCaseEnum } from "../model/Model";

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

export const supabaseGteSmall = new ONNXTransformerJsModel(
  "Supabase/gte-small",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 384 }
);

export const baaiBgeBaseEnV15 = new ONNXTransformerJsModel(
  "Xenova/bge-base-en-v1.5",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 768 }
);

export const xenovaMiniL6v2 = new ONNXTransformerJsModel(
  "Xenova/all-MiniLM-L6-v2",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 384 }
);

export const whereIsAIUAELargeV1 = new ONNXTransformerJsModel(
  "WhereIsAI/UAE-Large-V1",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 1024 }
);

export const baaiBgeSmallEnV15 = new ONNXTransformerJsModel(
  "Xenova/bge-small-en-v1.5",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 384 }
);

export const xenovaDistilbert = new ONNXTransformerJsModel(
  "Xenova/distilbert-base-uncased-distilled-squad",
  [ModelUseCaseEnum.TEXT_QUESTION_ANSWERING],
  "question-answering"
);

export const xenovaDistilbertMnli = new ONNXTransformerJsModel(
  "Xenova/distilbert-base-uncased-mnli",
  [ModelUseCaseEnum.TEXT_CLASSIFICATION],
  "zero-shot-classification"
);

export const stentancetransformerMultiQaMpnetBaseDotV1 = new ONNXTransformerJsModel(
  "Xenova/multi-qa-mpnet-base-dot-v1",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 768 }
);

export const gpt2 = new ONNXTransformerJsModel(
  "Xenova/gpt2",
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text-generation"
);

export const distillgpt2 = new ONNXTransformerJsModel(
  "Xenova/distilgpt2",
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text-generation"
);

export const flanT5small = new ONNXTransformerJsModel(
  "Xenova/flan-t5-small",
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text2text-generation"
);

export const flanT5p786m = new ONNXTransformerJsModel(
  "Xenova/LaMini-Flan-T5-783M",
  [ModelUseCaseEnum.TEXT_GENERATION, ModelUseCaseEnum.TEXT_REWRITING],
  "text2text-generation"
);

export const distilbartCnn = new ONNXTransformerJsModel(
  "Xenova/distilbart-cnn-6-6",
  [ModelUseCaseEnum.TEXT_SUMMARIZATION],
  "summarization"
);

// export const llamav2p7b = new GgmlLocalModel(
//   "GGUF/LlamaV2-7B-16f",
//   [ModelUseCaseEnum.TEXT_GENERATION],
//   { contextWindow: 4096, paramters: 7000000000 }
// );

// export const llamav2p13b = new GgmlLocalModel(
//   "GGUF/LlamaV2-13B-16f",
//   [ModelUseCaseEnum.TEXT_GENERATION],
//   { contextWindow: 4096, paramters: 13000000000 }
// );

// export const llamav2p70b = new GgmlLocalModel(
//   "GGUF/LlamaV2-70B-16f",
//   [ModelUseCaseEnum.TEXT_GENERATION],
//   { contextWindow: 4096, paramters: 70000000000 }
// );

export function findModelByName(name: string) {
  if (typeof name != "string") return undefined;
  return Model.all.find((m) => m.name.toLowerCase() == name.toLowerCase());
}

export function findModelByUseCase(usecase: ModelUseCaseEnum) {
  return Model.all.filter((m) => m.useCase.includes(usecase));
}

export function findAllModels() {
  return Model.all.slice();
}
