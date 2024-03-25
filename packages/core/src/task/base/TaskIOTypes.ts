//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { similarity_fn } from "../SimilarityTask";
import { Document } from "../../source/Document";

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

export const valueTypes = {
  any: {
    name: "Any",
    tsType: "any",
  },
  boolean: {
    name: "Boolean",
    tsType: "boolean",
  },
  text: {
    name: "Text",
    tsType: "string",
    defaultValue: "",
  },
  number: {
    name: "Number",
    tsType: "number",
    defaultValue: 0,
  },
  vector: {
    name: "Vector",
    tsType: "vector",
    defaultValue: [],
  },
  model: {
    name: "Model",
    tsType: "string",
  },
  text_embedding_model: {
    name: "Embedding Model",
    tsType: "string",
  },
  text_generation_model: {
    name: "Generation Model",
    tsType: "string",
  },
  text_summarization_model: {
    name: "Summarization Model",
    tsType: "string",
  },
  text_question_answering_model: {
    name: "Q&A Model",
    tsType: "string",
  },
  log_level: {
    name: "Log Level",
    tsType: "log_level",
  },
  doc_parser: {
    name: "Document Parser",
    tsType: "doc_parser",
  },
  doc_variant: {
    name: "Document Variant",
    tsType: "doc_variant",
  },
  document: {
    name: "Document",
    tsType: "document",
  },
  file: {
    name: "File",
    tsType: "string",
  },
  similarity_fn: {
    name: "Similarity Function",
    tsType: "similarity_fn",
  },
} as const;

export type ValueTypesIndex = keyof typeof valueTypes;

const log_levels = ["dir", "log", "debug", "info", "warn", "error"] as const;
type LogLevel = (typeof log_levels)[number];

const doc_variants = [
  "tree",
  "flat",
  "tree-paragraphs",
  "flat-paragraphs",
  "tree-sentences",
  "flat-sentences",
] as const;
type DocVariant = (typeof doc_variants)[number];
const doc_parsers = ["txt", "md"] as const; // | "html" | "pdf" | "csv";
type DocParser = (typeof doc_parsers)[number];

// Provided lookup type
interface TsTypes {
  any: any;
  boolean: boolean;
  string: string;
  number: number;
  vector: ElVector;
  log_level: LogLevel;
  doc_parser: DocParser;
  doc_variant: DocVariant;
  similarity_fn: (typeof similarity_fn)[number];
  document: Document;
}

export function validateItem(valueType: ValueTypesIndex, item: any): boolean {
  switch (valueType) {
    case "text":
    case "model":
    case "text_embedding_model":
    case "text_generation_model":
    case "text_summarization_model":
    case "text_question_answering_model":
    case "similarity_fn":
    case "file":
      return typeof item === "string";
    case "number":
      return typeof item === "number";
    case "boolean":
      return typeof item === "boolean";
    case "vector":
      return item instanceof ElVector;
    case "log_level":
      return log_levels.includes(item);
    case "doc_parser":
      return doc_parsers.includes(item);
    case "doc_variant":
      return doc_variants.includes(item);
    case "document":
      return item instanceof Document;
    case "vector":
      return item instanceof ElVector;
    case "any":
      return true;
    default:
      console.warn("Unknown value type: ", valueType, item);
      return false;
  }
}

// Extract TypeScript type for a given value type
export type ExtractTsType<VT extends ValueTypesIndex> = TsTypes[(typeof valueTypes)[VT]["tsType"]];

type InputType = {
  id: string | number;
  valueType: ValueTypesIndex;
  isArray?: boolean;
};

type MappedType<T extends InputType> = T["isArray"] extends true
  ? { [K in T["id"]]: Array<ExtractTsType<T["valueType"]>> }
  : { [K in T["id"]]: ExtractTsType<T["valueType"]> };

export type CreateMappedType<T extends ReadonlyArray<InputType>> = {
  [P in T[number] as P["id"]]: MappedType<P>[P["id"]];
};

export type TaskInputDefinition = {
  readonly id: string;
  readonly name: string;
  readonly valueType: ValueTypesIndex;
  readonly isArray?: boolean;
  readonly defaultValue?: ExtractTsType<ValueTypesIndex>;
};

export type TaskOutputDefinition = {
  readonly id: string;
  readonly name: string;
  readonly valueType: ValueTypesIndex;
  readonly isArray?: boolean;
};

export interface TaskNodeIO {
  readonly inputs: TaskInputDefinition[];
  readonly outputs: TaskOutputDefinition[];
}
