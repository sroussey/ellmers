//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import type { ModelFactory, SingleTask, TaskInput, TaskOutput } from "task";
import type { ModelProcessorEnum } from "../model/Model";

/**
 * This class is responsible for registering and storing the run functions for different tasks.
 */

export class ProviderRegistry {
  static runFnRegistry: Record<
    string,
    Record<string, (task: any, runInputData: any) => Promise<TaskOutput>>
  > = {};
  static registerRunFn(
    taskType: string,
    modelType: ModelProcessorEnum,
    runFn: (task: any, runInputData: any) => Promise<TaskOutput>
  ) {
    if (!ProviderRegistry.runFnRegistry[taskType]) ProviderRegistry.runFnRegistry[taskType] = {};
    ProviderRegistry.runFnRegistry[taskType][modelType] = runFn;
  }

  static getRunFn(taskType: string, modelType: ModelProcessorEnum) {
    return ProviderRegistry.runFnRegistry[taskType]?.[modelType];
  }
}
