//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Instruct, InstructList } from "#/Instruct";
import { ModelList, ONNXTransformerJsModel } from "#/Model";
import { StrategyList } from "#/Strategy";

export const supabaseGteSmall = new ONNXTransformerJsModel(
  "Supabase/gte-small",
  "feature-extraction",
  { dimensions: 384 }
);

export const baaiBgeSmallEnV15 = new ONNXTransformerJsModel(
  "Xenova/bge-small-en-v1.5",
  "feature-extraction",
  { dimensions: 384 }
);

export const baaiBgeBaseEnV15 = new ONNXTransformerJsModel(
  "Xenova/bge-base-en-v1.5",
  "feature-extraction",
  { dimensions: 768 }
);

export const xenovaMiniL6v2 = new ONNXTransformerJsModel(
  "Xenova/all-MiniLM-L6-v2",
  "feature-extraction",
  { dimensions: 384 }
);

export const whereIsAIUAELargeV1 = new ONNXTransformerJsModel(
  "WhereIsAI/UAE-Large-V1",
  "feature-extraction",
  { dimensions: 1024 }
);

export const xenovaDistilbert = new ONNXTransformerJsModel(
  "Xenova/distilbert-base-uncased-distilled-squad",
  "question-answering"
);

export const xenovaDistilbertMnli = new ONNXTransformerJsModel(
  "Xenova/distilbert-base-uncased-mnli",
  "zero-shot-classification"
);

export const gpt2 = new ONNXTransformerJsModel(
  "Xenova/gpt2",
  "text-generation"
);

export const distilbartCnn = new ONNXTransformerJsModel(
  "Xenova/distilbart-cnn-6-6",
  "summarization"
);

export const allModels: ONNXTransformerJsModel[] = [
  supabaseGteSmall,
  baaiBgeSmallEnV15,
  xenovaMiniL6v2,
  baaiBgeBaseEnV15,
  whereIsAIUAELargeV1,
  xenovaDistilbert,
  xenovaDistilbertMnli,
  gpt2,
  distilbartCnn,
];

export const featureExtractionModelList = allModels.filter(
  (m) => m.pipeline === "feature-extraction"
);
export const questionAnsweringModelList = allModels.filter(
  (m) => m.pipeline === "question-answering"
);
export const classifierModelList = allModels.filter(
  (m) => m.pipeline === "zero-shot-classification"
);
export const textgenModelList: ModelList = allModels.filter(
  (m) => m.pipeline === "text-generation"
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

for (const feModel of featureExtractionModelList) {
  for (const instruct of instructList) {
    strategyAllPairs.push({
      embeddingModel: feModel,
      instruct,
    });
  }
}
