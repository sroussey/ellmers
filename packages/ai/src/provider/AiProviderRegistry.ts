//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Job } from "@ellmers/job-queue";
import { TaskInput, TaskOutput } from "@ellmers/task-graph";

/**
 * Input data for the AiProviderJob
 */
interface AiProviderInput<Input extends TaskInput = TaskInput> {
  taskType: string;
  modelProvider: string;
  taskInput: Input;
}

/**
 * Type for the run function for the AiProviderJob
 */
export type AiProviderRunFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> = (
  job: AiProviderJob<Input, Output>,
  runInputData: Input,
  signal?: AbortSignal
) => Promise<Output>;

/**
 * Extends the base Job class to provide custom execution functionality
 * through a provided function.
 */
export class AiProviderJob<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> extends Job<AiProviderInput<Input>, Output> {
  execute(signal?: AbortSignal): Promise<Output> {
    const fn =
      getAiProviderRegistry().runFnRegistry[this.input.taskType]?.[this.input.modelProvider];
    if (!fn) {
      throw new Error(
        `No run function found for task type ${this.input.taskType} and model provider ${this.input.modelProvider}`
      );
    }
    return fn(
      this as unknown as AiProviderJob<Input, Output>,
      this.input.taskInput,
      signal
    ) as Promise<Output>;
  }
}

/**
 * Registry that manages provider-specific task execution functions and job queues.
 * Handles the registration, retrieval, and execution of task processing functions
 * for different model providers and task types.
 */
export class AiProviderRegistry {
  // Relaxing the generics using `any` allows us to register specialized run functions.
  runFnRegistry: Record<string, Record<string, AiProviderRunFn<any, any>>> = {};

  /**
   * Registers a task execution function for a specific task type and model provider
   * @param taskType - The type of task (e.g., 'text-generation', 'embedding')
   * @param modelProvider - The provider of the model (e.g., 'hf-transformers', 'tf-mediapipe', 'openai', etc)
   * @param runFn - The function that executes the task
   */
  registerRunFn(taskType: string, modelProvider: string, runFn: any) {
    if (!this.runFnRegistry[taskType]) this.runFnRegistry[taskType] = {};
    this.runFnRegistry[taskType][modelProvider] = runFn;
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
let providerRegistry: AiProviderRegistry;
export function getAiProviderRegistry() {
  if (!providerRegistry) providerRegistry = new AiProviderRegistry();
  return providerRegistry;
}
export function setAiProviderRegistry(pr: AiProviderRegistry) {
  providerRegistry = pr;
}
