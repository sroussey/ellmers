//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

/**
 * @file ModelFactory.ts
 * @description This file contains the implementation of the ModelFactory class and its derived classes.
 * The ModelFactory class is responsible for creating and running tasks based on different models.
 * It provides a common interface for running tasks and handles the execution logic.
 * Each derived class defines its own input and output types and implements the run() method to perform the task-specific logic.
 */

import { findModelByName } from "../storage/InMemoryStorage";
import { ModelProcessorEnum } from "../model/Model";
import { SingleTask, TaskInput, TaskConfig, TaskOutput } from "./Task";
import { TaskInputDefinition, TaskOutputDefinition } from "./TaskIOTypes";

export class ModelFactory extends SingleTask {
  public static inputs: readonly TaskInputDefinition[];
  public static outputs: readonly TaskOutputDefinition[];
  static readonly type: string = "ModelFactory";
  declare runOutputData: TaskOutput;

  static runFnRegistry: Record<
    string,
    Record<string, (task: ModelFactory, runInputData: TaskInput) => Promise<TaskOutput>>
  > = {};
  static registerRunFn(
    baseClass: typeof ModelFactory,
    modelType: ModelProcessorEnum,
    runFn: (task: any, runInputData: any) => Promise<TaskOutput>
  ) {
    if (!ModelFactory.runFnRegistry[baseClass.type])
      ModelFactory.runFnRegistry[baseClass.type] = {};
    ModelFactory.runFnRegistry[baseClass.type][modelType] = runFn;
  }
  static getRunFn(taskClassName: string, modelType: ModelProcessorEnum) {
    return ModelFactory.runFnRegistry[taskClassName]?.[modelType];
  }

  constructor(config: TaskConfig = {}) {
    config.name ||= `${new.target.name}${config.input?.model ? " with model " + config.input?.model : ""}`;
    super(config);
  }

  async run(): Promise<TaskOutput> {
    this.emit("start");
    this.runOutputData = {};
    let results;
    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;
    try {
      const modelname = this.runInputData["model"];
      if (!modelname) throw new Error("ModelFactoryTask: No model name found");
      const model = findModelByName(modelname);
      if (!model) throw new Error("ModelFactoryTask: No model found");
      const runFn = ModelFactory.getRunFn(runtype, model.type);
      if (!runFn) throw new Error("ModelFactoryTask: No run function found for " + runtype);
      results = await runFn(this, this.runInputData);
    } catch (err) {
      this.emit("error", err);
      console.error(err);
      return {};
    }
    this.emit("complete");
    this.runOutputData = results ?? {};
    this.runOutputData = this.runSyncOnly();
    return this.runOutputData;
  }
  runSyncOnly(): TaskOutput {
    return this.runOutputData;
  }
}
