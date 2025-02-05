//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  Job,
  getTaskQueueRegistry,
  JobDetails,
  TaskInput,
  TaskOutput,
  JobQueueTask,
} from "ellmers-core";
/**
 * Enum to define the types of job queue execution
 */
export enum JobQueueRunType {
  local = "local",
  api = "api",
}

/**
 * Extends the base Job class to provide custom execution functionality
 * through a provided function.
 */
class ProviderJob<Input extends TaskInput, Output extends TaskOutput> extends Job<Input, Output> {
  constructor(
    details: JobDetails<Input, Output> & {
      fn: (signal?: AbortSignal) => Promise<Output>;
    }
  ) {
    const { fn, ...rest } = details;
    super(rest);
    this.fn = fn;
  }
  fn: (signal?: AbortSignal) => Promise<Output>;
  execute(signal?: AbortSignal): Promise<Output> {
    return this.fn(signal);
  }
}

/**
 * Registry that manages provider-specific task execution functions and job queues.
 * Handles the registration, retrieval, and execution of task processing functions
 * for different model providers and task types.
 */
export class AiProviderRegistry<Input extends TaskInput, Output extends TaskOutput> {
  // Registry of task execution functions organized by task type and model provider
  runFnRegistry: Record<
    string,
    Record<string, (task: any, runInputData: any, signal?: AbortSignal) => Promise<Output>>
  > = {};

  /**
   * Registers a task execution function for a specific task type and model provider
   * @param taskType - The type of task (e.g., 'text-generation', 'embedding')
   * @param modelProvider - The provider of the model (e.g., 'hf-transformers', 'tf-mediapipe', 'openai', etc)
   * @param runFn - The function that executes the task
   */
  registerRunFn(
    taskType: string,
    modelProvider: string,
    runFn: (task: any, runInputData: any, signal?: AbortSignal) => Promise<Output>
  ) {
    if (!this.runFnRegistry[taskType]) this.runFnRegistry[taskType] = {};
    this.runFnRegistry[taskType][modelProvider] = runFn;
  }

  /**
   * Creates a job wrapper around a task execution function
   * This allows the task to be queued and executed asynchronously
   */
  jobAsRunFn(taskType: string, modelProvider: string) {
    const fn = this.runFnRegistry[taskType]?.[modelProvider];
    return async (task: JobQueueTask, input: Input, signal?: AbortSignal) => {
      const queue = getTaskQueueRegistry().getQueue(modelProvider)!;
      const job = new ProviderJob({
        queueName: queue.queue,
        jobRunId: task.config.currentJobRunId, // could be undefined
        taskType: taskType,
        input: input,
        fn: async () => {
          return fn(task, input, signal);
        },
      });
      const jobId = await queue.add(job);
      task.config.queue = queue.queue;
      task.config.currentJobRunId = job.jobRunId; // no longer undefined
      task.config.currentJobId = jobId;

      const result = queue.waitFor(jobId);
      return result;
    };
  }

  /**
   * Retrieves the direct execution function for a task type and model
   * Bypasses the job queue system for immediate execution
   */
  getDirectRunFn(taskType: string, modelProvider: string) {
    return this.runFnRegistry[taskType]?.[modelProvider];
  }
}

// Singleton instance management for the ProviderRegistry
let providerRegistry: AiProviderRegistry<TaskInput, TaskOutput>;
export function getAiProviderRegistry() {
  if (!providerRegistry) providerRegistry = new AiProviderRegistry();
  return providerRegistry;
}
export function setAiProviderRegistry(pr: AiProviderRegistry<TaskInput, TaskOutput>) {
  providerRegistry = pr;
}
