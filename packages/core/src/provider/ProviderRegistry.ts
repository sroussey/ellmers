//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import type { TaskInput, TaskOutput } from "../task/base/Task";
import type { JobQueueLlmTask } from "../task/base/JobQueueLlmTask";
import type { ModelProcessorEnum } from "../model/Model";
import { Job, JobConstructorDetails } from "../job/Job";
import type { JobQueue } from "../job/JobQueue";

export enum JobQueueRunType {
  local = "local",
  api = "api",
}

class ProviderJob extends Job {
  constructor(
    details: JobConstructorDetails & {
      fn: () => Promise<TaskOutput>;
    }
  ) {
    const { fn, ...rest } = details;
    super(rest);
    this.fn = fn;
  }
  fn: () => Promise<TaskOutput>;
  execute(): Promise<TaskOutput> {
    return this.fn();
  }
}

export class ProviderRegistry {
  runFnRegistry: Record<
    string,
    Record<string, (task: any, runInputData: any) => Promise<TaskOutput>>
  > = {};
  registerRunFn(
    taskType: string,
    modelType: ModelProcessorEnum,
    runFn: (task: any, runInputData: any) => Promise<TaskOutput>
  ) {
    if (!this.runFnRegistry[taskType]) this.runFnRegistry[taskType] = {};
    this.runFnRegistry[taskType][modelType] = runFn;
  }

  jobAsRunFn(runtype: string, modelType: ModelProcessorEnum) {
    const fn = this.runFnRegistry[runtype]?.[modelType];
    return async (task: JobQueueLlmTask, input: TaskInput) => {
      const queue = this.queues.get(modelType)!;
      const job = new ProviderJob({
        queue: queue.queue,
        taskType: runtype,
        input: input,
        fn: async () => {
          return fn(task, input);
        },
      });
      const jobid = await queue.add(job);
      task.config.currentJobId = jobid;
      task.config.queue = queue.queue;

      const result = queue.waitFor(jobid);
      return result;
    };
  }

  getDirectRunFn(taskType: string, modelType: ModelProcessorEnum) {
    return this.runFnRegistry[taskType]?.[modelType];
  }

  queues: Map<ModelProcessorEnum, JobQueue> = new Map();
  registerQueue(modelType: ModelProcessorEnum, jobQueue: JobQueue) {
    this.queues.set(modelType, jobQueue);
  }

  getQueue(modelType: ModelProcessorEnum) {
    return this.queues.get(modelType);
  }

  startQueues() {
    for (const queue of this.queues.values()) {
      queue.start();
    }
  }

  stopQueues() {
    for (const queue of this.queues.values()) {
      queue.stop();
    }
  }

  clearQueues() {
    for (const queue of this.queues.values()) {
      queue.clear();
    }
  }
}

let providerRegistry: ProviderRegistry;
export function getProviderRegistry() {
  if (!providerRegistry) providerRegistry = new ProviderRegistry();
  return providerRegistry;
}
export function setProviderRegistry(providerRegistry: ProviderRegistry) {
  providerRegistry = providerRegistry;
}
