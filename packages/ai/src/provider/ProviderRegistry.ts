//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  Job,
  type JobQueue,
  JobConstructorDetails,
  TaskInput,
  TaskOutput,
  JobQueueTask,
} from "ellmers-core";

export enum JobQueueRunType {
  local = "local",
  api = "api",
}

class ProviderJob<Input, Output> extends Job<Input, Output> {
  constructor(
    details: JobConstructorDetails<Input, Output> & {
      fn: () => Promise<Output>;
    }
  ) {
    const { fn, ...rest } = details;
    super(rest);
    this.fn = fn;
  }
  fn: () => Promise<Output>;
  execute(): Promise<Output> {
    return this.fn();
  }
}

export class ProviderRegistry<Input, Output> {
  runFnRegistry: Record<string, Record<string, (task: any, runInputData: any) => Promise<Output>>> =
    {};
  registerRunFn(
    taskType: string,
    modelProvider: string,
    runFn: (task: any, runInputData: any) => Promise<Output>
  ) {
    if (!this.runFnRegistry[taskType]) this.runFnRegistry[taskType] = {};
    this.runFnRegistry[taskType][modelProvider] = runFn;
  }

  jobAsRunFn(runtype: string, modelType: string) {
    const fn = this.runFnRegistry[runtype]?.[modelType];
    return async (task: JobQueueTask, input: Input) => {
      const queue = this.queues.get(modelType)!;
      const job = new ProviderJob({
        queueName: queue.queue,
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

  getDirectRunFn(taskType: string, modelType: string) {
    return this.runFnRegistry[taskType]?.[modelType];
  }

  queues: Map<string, JobQueue<Input, Output>> = new Map();
  registerQueue(modelType: string, jobQueue: JobQueue<Input, Output>) {
    this.queues.set(modelType, jobQueue);
  }

  getQueue(modelType: string) {
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

let providerRegistry: ProviderRegistry<TaskInput, TaskOutput>;
export function getProviderRegistry() {
  if (!providerRegistry) providerRegistry = new ProviderRegistry();
  return providerRegistry;
}
export function setProviderRegistry(pr: ProviderRegistry<TaskInput, TaskOutput>) {
  providerRegistry = pr;
}
