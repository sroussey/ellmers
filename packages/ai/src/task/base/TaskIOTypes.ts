//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

export type AnyNumberArray =
  | number[]
  | Float64Array
  | Float32Array
  | Int32Array
  | Int16Array
  | Int8Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Uint8ClampedArray
  | BigInt64Array
  | BigUint64Array;

export class ElVector<T extends AnyNumberArray = AnyNumberArray> {
  normalized: boolean;
  vector: T;
  constructor(vector: T, normalized: boolean) {
    this.vector = vector;
    this.normalized = normalized;
  }
}

export type embedding_model = string;
export type generation_model = string;
export type question_answering_model = string;
export type rewriting_model = string;
export type classification_model = string;
export type summarization_model = string;
export type translation_model = string;
export type language = string;

export type model =
  | embedding_model
  | generation_model
  | question_answering_model
  | rewriting_model
  | classification_model
  | summarization_model
  | translation_model
  | generation_model
  | embedding_model;
