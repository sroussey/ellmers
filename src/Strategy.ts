//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Instruct } from "./Instruct";
import { Model } from "./Model";

/**
 * A strategy is a combination of a model and an instruction for that model.
 * This combination is used to generate embeddings for a document, and later
 * to generate embeddings for a query.
 *
 * A node (a block of text or clip of image) can have multiple embeddings,
 * though perferably only one in use at a time. This allows for updating
 * an embedding strategy while keeping the old one around for live use.
 *
 * It also allows for testing multiple strategies for a given dataset.
 */
export interface Strategy {
  model: Model;
  instruct: Instruct;
}

export type StrategyList = Strategy[];
