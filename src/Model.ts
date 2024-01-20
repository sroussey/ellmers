//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

export enum ModelProcessorType {
  LOCAL_ONNX_TRANSFORMERJS = "LOCAL_ONNX_TRANSFORMERJS",
  LOCAL_MLC = "LOCAL_MLC",
  LOCAL_LLAMACPP = "LOCAL_LLAMACPP",
  ONLINE_HUGGINGFACE = "ONLINE_HUGGINGFACE",
  ONLINE_OPENAI = "ONLINE_OPENAI",
  ONLINE_REPLICATE = "ONLINE_REPLICATE",
}

export abstract class Model {
  public static all = new Map<string, Model>();
  public dimensions: number | null = null;
  public normalize = true;
  public parameters: Record<string, string | number> = {};
  constructor(
    public name: string,
    options?: Partial<Pick<Model, "dimensions" | "parameters">>
  ) {
    Object.assign(this, options);
    Model.all.set(name, this);
  }
  abstract readonly type: ModelProcessorType;
}

export type ModelList = Model[];
