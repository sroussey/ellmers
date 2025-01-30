//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

/**
 * @description This file contains the implementation of the JobQueueTask class and its derived classes.
 */

import { JobQueueTask, JobQueueTaskConfig, type TaskOutput } from "ellmers-core";
import { getProviderRegistry } from "../../provider/ProviderRegistry";
import { getGlobalModelRepository } from "../../model/ModelRegistry";

export class JobQueueLlmTask extends JobQueueTask {
  static readonly type: string = "JobQueueLlmTask";

  constructor(config: JobQueueTaskConfig = {}) {
    config.name ||= `${new.target.type || new.target.name}${
      config.input?.model ? " with model " + config.input?.model : ""
    }`;
    super(config);
  }

  async run(): Promise<TaskOutput> {
    if (!this.validateInputData(this.runInputData)) {
      throw new Error("Invalid input data");
    }
    this.emit("start");
    this.runOutputData = {};
    let results;
    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;
    try {
      const ProviderRegistry = getProviderRegistry();
      const modelname = this.runInputData["model"];
      if (!modelname) throw new Error("JobQueueTaskTask: No model name found");
      const model = await getGlobalModelRepository().findByName(modelname);

      if (!model) {
        throw new Error(`JobQueueTaskTask: No model ${modelname} found ${modelname}`);
      }
      const runFn = ProviderRegistry.jobAsRunFn(runtype, model.provider);
      if (!runFn) throw new Error("JobQueueTaskTask: No run function found for " + runtype);
      results = await runFn(this, this.runInputData);
    } catch (err) {
      this.emit("error", err);
      console.error(err);
      return {};
    }
    this.runOutputData = results ?? {};
    this.runOutputData = await this.runReactive();
    this.emit("complete");
    return this.runOutputData;
  }
  async runReactive(): Promise<TaskOutput> {
    return this.runOutputData ?? {};
  }
}
