//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

export enum ModelProviderEnum {
  LOCAL_ONNX_TRANSFORMERJS = "LOCAL_ONNX_TRANSFORMERJS",
  MEDIA_PIPE_TFJS_MODEL = "MEDIA_PIPE_TFJS_MODEL",
  LOCAL_MLC = "LOCAL_MLC",
  LOCAL_LLAMACPP = "LOCAL_LLAMACPP",
  ONLINE_HUGGINGFACE = "ONLINE_HUGGINGFACE",
  ONLINE_OPENAI = "ONLINE_OPENAI",
  ONLINE_REPLICATE = "ONLINE_REPLICATE",
}

export enum ModelUseCaseEnum {
  TEXT_EMBEDDING = "TEXT_EMBEDDING",
  TEXT_REWRITING = "TEXT_REWRITING",
  TEXT_GENERATION = "TEXT_GENERATION",
  TEXT_SUMMARIZATION = "TEXT_SUMMARIZATION",
  TEXT_QUESTION_ANSWERING = "TEXT_QUESTION_ANSWERING",
  TEXT_CLASSIFICATION = "TEXT_CLASSIFICATION",
  TEXT_TRANSLATION = "TEXT_TRANSLATION",
}

export interface ModelPrimaryKey {
  name: string;
  provider: ModelProviderEnum;
  quantization: string;
}

export const ModelPrimaryKeySchema = {
  name: "string",
  provider: "string",
  quantization: "string",
} as const;

export interface ModelDetail {
  useCase: ModelUseCaseEnum;
  pipeline: string;
  nativeDimensions: number;
  usingDimensions: number;
  contextWindow: number;
  availableOnBrowser: boolean;
  availableOnServer: boolean;
  parameters: number;
  languageStyle: string;
}

export const ModelDetailSchema = {
  useCase: "string",
  pipeline: "string",
  nativeDimensions: "number",
  usingDimensions: "number",
  contextWindow: "number",
  availableOnBrowser: "boolean",
  availableOnServer: "boolean",
  parameters: "number",
  languageStyle: "string",
} as const;

export class Model implements ModelPrimaryKey, ModelDetail {
  constructor(
    public name: string,
    public provider: ModelProviderEnum,
    public quantization: string,
    details: ModelDetail
  ) {
    this.useCase = details.useCase;
    this.pipeline = details.pipeline;
    this.nativeDimensions = details.nativeDimensions;
    this.usingDimensions = details.usingDimensions;
    this.contextWindow = details.contextWindow;
    this.availableOnBrowser = details.availableOnBrowser;
    this.availableOnServer = details.availableOnServer;
    this.parameters = details.parameters;
    this.languageStyle = details.languageStyle;
  }
  public useCase: ModelUseCaseEnum;
  public pipeline: string;
  public nativeDimensions: number;
  public usingDimensions: number;
  public contextWindow: number;
  public availableOnBrowser: boolean;
  public availableOnServer: boolean;
  public parameters: number;
  public languageStyle: string;
}

// const runningOnServer = typeof (globalThis as any).window === "undefined";

// export interface ModelOptions {
//   nativeDimensions?: number; // Matryoshka Representation Learning (MRL) -- can truncate embedding dimensions from native number
//   dimensions?: number;
//   contextWindow?: number;
//   extras?: Record<string, string | number>;
//   browserOnly?: boolean;
//   parameters?: number;
//   languageStyle?: string;
// }

// export abstract class Model implements ModelOptions {
//   public dimensions?: number;
//   public nativeDimensions?: number;
//   public contextWindow?: number;
//   public normalize: boolean = true;
//   public browserOnly: boolean = false;
//   public extras: Record<string, string | number> = {};
//   public parameters?: number;
//   constructor(
//     public name: string,
//     public useCase: ModelUseCaseEnum[] = [],
//     options?: ModelOptions
//   ) {
//     Object.assign(this, options);
//   }
//   abstract readonly type: ModelProviderEnum;
// }

// export type ModelList = Model[];
