//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

/**
 * @description This file contains the implementation of the JobQueueTask class and its derived classes.
 */

import { findModelByName } from "../../storage/InMemoryStorage";
import { JobQueueTask, JobQueueTaskConfig } from "./JobQueueTask";
import type { TaskOutput } from "./Task";
import { getProviderRegistry } from "provider/ProviderRegistry";

export abstract class JobQueueLlmTask extends JobQueueTask {
  static readonly type: string = "JobQueueLlmTask";

  constructor(config: JobQueueTaskConfig = {}) {
    config.name ||= `${new.target.name}${
      config.input?.model ? " with model " + config.input?.model : ""
    }`;
    super(config);
  }

  async run(): Promise<TaskOutput> {
    this.emit("start");
    this.runOutputData = {};
    let results;
    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;
    try {
      const ProviderRegistry = getProviderRegistry();
      const modelname = this.runInputData["model"];
      if (!modelname) throw new Error("JobQueueTaskTask: No model name found");
      const model = findModelByName(modelname);
      if (!model) throw new Error("JobQueueTaskTask: No model found");
      const runFn = ProviderRegistry.jobAsRunFn(runtype, model.type);
      if (!runFn) throw new Error("JobQueueTaskTask: No run function found for " + runtype);
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
    return this.runOutputData ?? {};
  }
}
