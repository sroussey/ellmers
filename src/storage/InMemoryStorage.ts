//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Instruct, InstructList } from "#/Instruct";
import { Model, ModelUseCaseEnum } from "#/Model";
import { StrategyList } from "#/Strategy";
import { ONNXTransformerJsModel } from "#/tasks/HuggingFaceLocalTasks";
import { MediaPipeTfJsModel } from "#/tasks/MediaPipeLocalTasks";

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

export const stentancetransformerMultiQaMpnetBaseDotV1 =
  new ONNXTransformerJsModel(
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
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text2text-generation"
);

export const distilbartCnn = new ONNXTransformerJsModel(
  "Xenova/distilbart-cnn-6-6",
  [ModelUseCaseEnum.TEXT_SUMMARIZATION],
  "summarization"
);

export const instructPlain = new Instruct(
  "Plain",
  "The plain version does nothing extra to queries or storage"
);

export const instructHighTemp = new Instruct(
  "HighTemp",
  "This is similar to plain but with a higher temperature and four versions averaged together",
  { parameters: { temperature: 2.5, versions: 4 } } // no model, so inert for now
);

export const instructQuestion = new Instruct(
  "EverythingIsAQuestion",
  "This converts storage into questions",
  { storageInstruction: "Rephrase the following as a question: ", model: gpt2 }
);

export const instructSummarize = new Instruct(
  "Summarize",
  "This converts storage into summaries",
  { model: distilbartCnn }
);

export const instructRepresent = new Instruct(
  "Represent",
  "This tries to coax the model into representing the query or passage",
  {
    queryInstruction: "Represent this query for searching relevant passages: ",
    storageInstruction: "Represent this passage for later retrieval: ",
  } // no model, so inert
);

export const instructKeywords = new Instruct(
  "Keywords",
  "Try and pull keywords and concepts from both query and storage",
  {
    queryInstruction:
      "What are the most important keywords and concepts that represent the following: ",
    storageInstruction:
      "What are the most important keywords and concepts that represent the following: ",
    model: xenovaDistilbertMnli, // doesn't work
  }
);

export const instructList: InstructList = [
  instructPlain,
  // instructHighTemp,
  // instructQuestion,
  // instructRepresent,
  instructSummarize,
];

export const strategyAllPairs: StrategyList = [];

for (const feModel of findModelByUseCase(ModelUseCaseEnum.TEXT_EMBEDDING)) {
  for (const instruct of instructList) {
    strategyAllPairs.push({
      embeddingModel: feModel,
      instruct,
    });
  }
}

export function findModelByName(name: string) {
  return Model.all.find((m) => m.name.toLowerCase() == name.toLowerCase());
}

export function findModelByUseCase(usecase: ModelUseCaseEnum) {
  return Model.all.filter((m) => m.useCase.includes(usecase));
}

export function findAllModels() {
  return Model.all.slice();
}
