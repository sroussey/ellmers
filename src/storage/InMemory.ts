//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Instruct, InstructList } from "#/Instruct";
import { Model, ModelList } from "#/Model";
import { StrategyList } from "#/Strategy";

export const modelList: ModelList = [
  new Model("Supabase/gte-small", 384, {}),
  new Model("Xenova/bge-small-en-v1.5", 384, {}),
];

export const instructList: InstructList = [
  new Instruct(
    "Plain",
    "The plain version does nothing extra to queries or storage",
    "",
    "",
    {}
  ),
  new Instruct(
    "HighTemp",
    "This is similar to plain but with a higher temperature and four versions averaged together",
    "",
    "",
    { temperature: 2.5, versions: 4 }
  ),
  new Instruct(
    "EverythingIsAQuestion",
    "This converts storage into questions",
    "Rephrase the following as a question: ",
    "Rephrase the following as a question: ",
    {}
  ),
  new Instruct(
    "Represent",
    "This tries to coax the model into representing the query or passage",
    "Represent this query for searching relevant passages: ",
    "Represent this passage for later retrieval: ",
    {}
  ),
  new Instruct(
    "Keywords",
    "Try and pull keywords and concepts from both query and storage",
    "What are the most important keywords and concepts that represent the following: ",
    "What are the most important keywords and concepts that represent the following: ",
    {}
  ),
];

export const stategyAllPairs: StrategyList = [];

for (const model of modelList) {
  for (const instruct of instructList) {
    stategyAllPairs.push({ model, instruct });
  }
}
