//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model, ModelOptions, ModelProcessorEnum, ModelUseCaseEnum } from "./Model";

export class ONNXTransformerJsModel extends Model {
  constructor(
    name: string,
    useCase: ModelUseCaseEnum[],
    public pipeline: string,
    options?: Pick<ModelOptions, "dimensions" | "parameters" | "languageStyle">
  ) {
    super(name, useCase, options);
  }
  readonly type = ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS;
}
