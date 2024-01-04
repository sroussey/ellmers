//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Instruct, InstructList } from "#/Instruct";
import { Model, ModelList } from "#/Model";
import { StrategyList } from "#/Strategy";

export const supabaseGteSmall = new Model(
  "Supabase/gte-small",
  384,
  "feature-extraction",
  {}
);
export const xenovaBgeSmallEnV15 = new Model(
  "Xenova/bge-small-en-v1.5",
  384,
  "feature-extraction",
  {}
);

export const xenovaDistilbert = new Model(
  "Xenova/distilbert-base-uncased-distilled-squad",
  384,
  "question-answering",
  {}
);

export const modelList: ModelList = [supabaseGteSmall, xenovaBgeSmallEnV15];

export const instructPlain = new Instruct(
  "Plain",
  "The plain version does nothing extra to queries or storage",
  "",
  "",
  {}
);

export const highTemp = new Instruct(
  "HighTemp",
  "This is similar to plain but with a higher temperature and four versions averaged together",
  "",
  "",
  { temperature: 2.5, versions: 4 }
);

export const instructQuestion = new Instruct(
  "EverythingIsAQuestion",
  "This converts storage into questions",
  "",
  "Rephrase the following as a question: ",
  {}
);

export const instructRepresent = new Instruct(
  "Represent",
  "This tries to coax the model into representing the query or passage",
  "Represent this query for searching relevant passages: ",
  "Represent this passage for later retrieval: ",
  {}
);

export const instructKeywords = new Instruct(
  "Keywords",
  "Try and pull keywords and concepts from both query and storage",
  "What are the most important keywords and concepts that represent the following: ",
  "What are the most important keywords and concepts that represent the following: ",
  {}
);

export const instructList: InstructList = [
  instructPlain,
  highTemp,
  instructQuestion,
  instructRepresent,
  instructKeywords,
];

export const strategyAllPairs: StrategyList = [];

for (const model of modelList) {
  for (const instruct of instructList) {
    strategyAllPairs.push({ model, instruct });
  }
}
