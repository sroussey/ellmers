//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Job, type JobQueue, JobDetails, TaskInput, TaskOutput, JobQueueTask } from "ellmers-core";

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
class ProviderJob<Input, Output> extends Job<Input, Output> {
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
export class AiProviderRegistry<Input, Output> {
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
  jobAsRunFn(runtype: string, modelType: string) {
    const fn = this.runFnRegistry[runtype]?.[modelType];
    return async (task: JobQueueTask, input: Input, signal?: AbortSignal) => {
      const queue = this.queues.get(modelType)!;
      const job = new ProviderJob({
        queueName: queue.queue,
        taskType: runtype,
        input: input,
        fn: async () => {
          return fn(task, input, signal);
        },
      });
      const jobid = await queue.add(job);
      task.config.currentJobId = jobid;
      task.config.queue = queue.queue;

      const result = queue.waitFor(jobid);
      return result;
    };
  }

  /**
   * Retrieves the direct execution function for a task type and model
   * Bypasses the job queue system for immediate execution
   */
  getDirectRunFn(taskType: string, modelType: string) {
    return this.runFnRegistry[taskType]?.[modelType];
  }

  // Map of model types to their corresponding job queues
  queues: Map<string, JobQueue<Input, Output>> = new Map();

  /**
   * Queue management methods for starting, stopping, and clearing job queues
   * These methods help control the execution flow of tasks across all providers
   */
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
      queue.deleteAll();
    }
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
