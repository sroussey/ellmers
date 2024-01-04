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
  constructor(
    public name: string,
    public dimensions: number,
    public parameters: Record<string, string | number>
  ) {}
  abstract readonly type: ModelProcessorType;
}

export class ONNXTransformerJsModel extends Model {
  constructor(
    name: string,
    dimensions: number,
    parameters: Record<string, string | number>,
    public pipeline: string
  ) {
    super(name, dimensions, parameters);
  }
  readonly type = ModelProcessorType.LOCAL_ONNX_TRANSFORMERJS;
}

export type ModelList = Model[];
