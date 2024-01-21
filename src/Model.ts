//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

export enum ModelProcessorEnum {
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
}

const runningOnServer = typeof (globalThis as any).window === "undefined";

export abstract class Model {
  public static readonly all: ModelList = [];
  public dimensions: number | null = null;
  public normalize: boolean = true;
  public browserOnly: boolean = false;
  public parameters: Record<string, string | number> = {};
  constructor(
    public name: string,
    public useCase: ModelUseCaseEnum[] = [],
    options?: Partial<Pick<Model, "dimensions" | "parameters" | "browserOnly">>
  ) {
    Object.assign(this, options);
    if (!(runningOnServer && this.browserOnly)) {
      Model.all.push(this);
    }
  }
  abstract readonly type: ModelProcessorEnum;
}

export type ModelList = Model[];
