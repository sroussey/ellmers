//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model, ModelOptions, ModelProcessorEnum, ModelUseCaseEnum } from "ellmers-task-llm";

export class MediaPipeTfJsModel extends Model {
  constructor(
    name: string,
    useCase: ModelUseCaseEnum[],
    public url: string,
    options?: Pick<ModelOptions, "dimensions" | "browserOnly">
  ) {
    super(name, useCase, options);
  }
  readonly type = ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL;
}
