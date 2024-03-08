//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Document } from "../../source/Document";

export type Vector = number[] | Float32Array;

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
    tsType: "Vector",
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
    tsType: "Document",
  },
  file: {
    name: "File",
    tsType: "string",
  },
} as const;

// Provided lookup type
type TsTypes = {
  any: any;
  boolean: boolean;
  string: string;
  number: number;
  Vector: Vector;
  log_level: "dir" | "log" | "debug" | "info" | "warn" | "error";
  doc_parser: "txt" | "md"; // | "html" | "pdf" | "csv";
  doc_variant:
    | "tree"
    | "flat"
    | "tree-paragraphs"
    | "flat-paragraphs"
    | "tree-sentences"
    | "flat-sentences";
  Document: Document;
};

// Extract TypeScript type for a given value type
export type ExtractTsType<VT extends keyof typeof valueTypes> =
  TsTypes[(typeof valueTypes)[VT]["tsType"]];

type InputType = {
  id: string | number;
  valueType: keyof typeof valueTypes;
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
  readonly valueType: keyof typeof valueTypes;
  readonly isArray?: boolean;
  readonly defaultValue?: ExtractTsType<keyof typeof valueTypes>;
};

export type TaskOutputDefinition = {
  readonly id: string;
  readonly name: string;
  readonly valueType: keyof typeof valueTypes;
  readonly isArray?: boolean;
};

export interface TaskNodeIO {
  readonly inputs: TaskInputDefinition[];
  readonly outputs: TaskOutputDefinition[];
}
