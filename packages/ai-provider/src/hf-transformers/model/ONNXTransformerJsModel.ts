//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model, ModelDetail, ModelProviderEnum, ModelUseCaseEnum } from "ellmers-ai";

export enum QUANTIZATION_DATA_TYPES {
  auto = "auto", // Auto-detect based on environment
  fp32 = "fp32",
  fp16 = "fp16",
  q8 = "q8",
  int8 = "int8",
  uint8 = "uint8",
  q4 = "q4",
  bnb4 = "bnb4",
  q4f16 = "q4f16", // fp16 model with int4 block weight quantization
}

export interface ONNXTransformerJsModelOptions extends ModelDetail {
  quantization?: QUANTIZATION_DATA_TYPES;
}

export class ONNXTransformerJsModel extends Model implements ONNXTransformerJsModelOptions {
  constructor(
    name: string,
    useCase: ModelUseCaseEnum[],
    public pipeline: string,
    options?: Pick<
      ONNXTransformerJsModelOptions,
      "dimensions" | "parameters" | "languageStyle" | "dtype"
    >
  ) {
    super(name, useCase, options);
    this.dtype = options?.dtype ?? DATA_TYPES.q8;
  }
  readonly type = ModelProviderEnum.LOCAL_ONNX_TRANSFORMERJS;
  dtype?: DATA_TYPES | { [key: string]: DATA_TYPES } | undefined;
}
