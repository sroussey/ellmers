/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { StreamEvent } from "@workglow/task-graph";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util/worker";
import type { JsonSchema } from "@workglow/util/worker";
import { DirectExecutionStrategy } from "../execution/DirectExecutionStrategy";
import type { IAiExecutionStrategy, AiStrategyResolver } from "../execution/IAiExecutionStrategy";
import type { ModelConfig } from "../model/ModelSchema";
import type { AiProvider } from "./AiProvider";

/**
 * Type for the run function for the AiJob.
 * The optional `outputSchema` is provided when the task declares structured output
 * (via `x-structured-output: true`). Providers use it to request schema-conformant
 * JSON output from the model API.
 */
export type AiProviderRunFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (
  input: Input,
  model: Model | undefined,
  update_progress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal,
  outputSchema?: JsonSchema,
  sessionId?: string
) => Promise<Output>;

/**
 * Type for the preview run function for AiTask.executePreview().
 * Computes a fast preview from input alone -- no prior output needed.
 * No `signal` or `update_progress` -- preview execution is lightweight and synchronous-ish.
 */
export type AiProviderPreviewRunFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (input: Input, model: Model | undefined) => Promise<Output | undefined>;

/**
 * Type for the streaming run function for the AiJob.
 * Returns an AsyncIterable of StreamEvents instead of a Promise.
 * No `update_progress` callback -- for streaming providers, the stream itself IS the progress signal.
 * The optional `outputSchema` is provided for structured output tasks.
 *
 * Streaming primitive: this is the canonical authoring surface for provider streams.
 * Implementations MUST be `async function*` generators returning `AsyncIterable`.
 * Do not return a `ReadableStream` -- `ReadableStream` is an engine-internal primitive
 * used only at the dataflow edge for fan-out via `tee()`.
 *
 * Finish convention: yield `{ type: "finish", data: {} as Output }` at the end.
 * Do not accumulate deltas into the finish payload -- the `StreamingAiTask` / `TaskRunner`
 * consumer handles accumulation.
 *
 * @cancel The provided `signal` MUST be forwarded to the underlying SDK or fetch.
 * Generators MUST stop yielding promptly after `signal.aborted` becomes true -- either
 * because the underlying SDK tears down the connection, or because the generator checks
 * `signal.aborted` at loop boundaries. Use `try { ... } finally { ... }` to release any
 * resources (readers, timers) -- `finally` runs when the consumer stops iterating on abort.
 * On abort, the consumer will throw `TaskAbortedError`; do not swallow abort errors.
 */
export type AiProviderStreamFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (
  input: Input,
  model: Model | undefined,
  signal: AbortSignal,
  outputSchema?: JsonSchema,
  sessionId?: string
) => AsyncIterable<StreamEvent<Output>>;

/**
 * Registry that manages provider-specific task execution functions and job queues.
 * Handles the registration, retrieval, and execution of task processing functions
 * for different model providers and task types.
 */
export class AiProviderRegistry {
  runFnRegistry: Map<string, Map<string, AiProviderRunFn<any, any>>> = new Map();
  streamFnRegistry: Map<string, Map<string, AiProviderStreamFn<any, any>>> = new Map();
  previewRunFnRegistry: Map<string, Map<string, AiProviderPreviewRunFn<any, any>>> = new Map();
  private providers: Map<string, AiProvider<any>> = new Map();
  private strategyResolvers: Map<string, AiStrategyResolver> = new Map();
  private defaultStrategy: IAiExecutionStrategy | undefined;

  /**
   * Registers an AiProvider instance for lifecycle management and introspection.
   * @param provider - The provider instance to register
   */
  registerProvider(provider: AiProvider<any>): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Removes a previously registered provider and all of its run/stream/preview functions.
   * Used for cleanup when provider initialization fails partway through.
   * @param name - The provider name to unregister
   */
  unregisterProvider(name: string): void {
    this.providers.delete(name);
    this.strategyResolvers.delete(name);
    // Remove all run functions for this provider
    for (const [, providerMap] of this.runFnRegistry) {
      providerMap.delete(name);
    }
    for (const [, providerMap] of this.streamFnRegistry) {
      providerMap.delete(name);
    }
    for (const [, providerMap] of this.previewRunFnRegistry) {
      providerMap.delete(name);
    }
  }

  /**
   * Retrieves a registered AiProvider instance by name.
   * @param name - The provider name (e.g., "HF_TRANSFORMERS_ONNX")
   * @returns The provider instance, or undefined if not found
   */
  getProvider(name: string): AiProvider<any> | undefined {
    return this.providers.get(name);
  }

  /**
   * Returns all registered AiProvider instances.
   */
  getProviders(): Map<string, AiProvider<any>> {
    return new Map(this.providers);
  }

  /**
   * Stable-sorted ids of all {@link AiProvider} instances currently registered
   * via {@link registerProvider} (typically after {@link AiProvider.register}).
   */
  getInstalledProviderIds(): string[] {
    return [...this.providers.keys()].sort();
  }

  /**
   * Registers a strategy resolver for a provider. The resolver receives the full
   * ModelConfig at execution time and returns the appropriate execution strategy.
   * This allows model-aware decisions (e.g., HFT WebGPU → queued, HFT WASM → direct).
   */
  registerStrategyResolver(providerName: string, resolver: AiStrategyResolver): void {
    this.strategyResolvers.set(providerName, resolver);
  }

  /**
   * Sets the default execution strategy used when no provider-specific resolver
   * is registered. Useful in tests to inject a strategy without registering a
   * full provider.
   */
  setDefaultStrategy(strategy: IAiExecutionStrategy): void {
    this.defaultStrategy = strategy;
  }

  /**
   * Resolves the execution strategy for a given model config.
   * Falls back to DirectExecutionStrategy if no resolver is registered.
   */
  getStrategy(model: ModelConfig): IAiExecutionStrategy {
    const resolver = this.strategyResolvers.get(model.provider);
    if (resolver) return resolver(model);
    if (!this.defaultStrategy) {
      this.defaultStrategy = new DirectExecutionStrategy();
    }
    return this.defaultStrategy;
  }

  /**
   * Creates a session on the named provider.
   * @param providerName - The provider to create a session on
   * @param model - The model configuration for the session
   * @returns An opaque session ID
   * @throws If the provider is not registered
   */
  createSession(providerName: string, model: ModelConfig): string {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(
        `No provider found for "${providerName}". Register the provider before creating sessions.`
      );
    }
    return provider.createSession(model);
  }

  /**
   * Disposes a session on the named provider. Silently ignores unknown providers.
   * @param providerName - The provider that owns the session
   * @param sessionId - The session ID to dispose
   */
  async disposeSession(providerName: string, sessionId: string): Promise<void> {
    const provider = this.providers.get(providerName);
    if (provider) {
      await provider.disposeSession(sessionId);
    }
  }

  /**
   * Stable-sorted provider ids that have a direct run function registered for `taskType`.
   * Use this when the UI or validation should only offer providers that can execute a task
   * (e.g. {@link ModelSearchTask}).
   */
  getProviderIdsForTask(taskType: string): string[] {
    const taskMap = this.runFnRegistry.get(taskType);
    if (!taskMap) return [];
    return [...taskMap.keys()].sort();
  }

  /**
   * Registers a task execution function for a specific task type and model provider
   * @param taskType - The type of task (e.g., 'text-generation', 'embedding')
   * @param modelProvider - The provider of the model (e.g., 'hf-transformers', 'tf-mediapipe', 'openai', etc)
   * @param runFn - The function that executes the task
   */
  registerRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string,
    runFn: AiProviderRunFn<Input, Output>
  ) {
    if (!this.runFnRegistry.has(taskType)) {
      this.runFnRegistry.set(taskType, new Map());
    }
    this.runFnRegistry.get(taskType)!.set(modelProvider, runFn);
  }

  registerAsWorkerRunFn<
    Input extends TaskInput = TaskInput,
    Output extends TaskOutput = TaskOutput,
  >(modelProvider: string, taskType: string) {
    const workerFn: AiProviderRunFn<Input, Output> = async (
      input: Input,
      model: ModelConfig | undefined,
      update_progress: (progress: number, message?: string, details?: any) => void,
      signal?: AbortSignal,
      outputSchema?: JsonSchema,
      sessionId?: string
    ) => {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      const result = await workerManager.callWorkerFunction<Output>(
        modelProvider,
        taskType,
        [input, model, outputSchema, sessionId],
        {
          signal: signal,
          onProgress: update_progress,
        }
      );
      return result;
    };
    this.registerRunFn<Input, Output>(modelProvider, taskType, workerFn);
  }

  /**
   * Registers a streaming execution function for a specific task type and model provider.
   * @param modelProvider - The provider of the model (e.g., 'openai', 'anthropic', etc.)
   * @param taskType - The type of task (e.g., 'TextGenerationTask')
   * @param streamFn - The async generator function that yields StreamEvents
   */
  registerStreamFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string,
    streamFn: AiProviderStreamFn<Input, Output>
  ) {
    if (!this.streamFnRegistry.has(taskType)) {
      this.streamFnRegistry.set(taskType, new Map());
    }
    this.streamFnRegistry.get(taskType)!.set(modelProvider, streamFn);
  }

  /**
   * Registers a worker-proxied streaming function for a specific task type and model provider.
   * Creates a proxy that delegates streaming to a Web Worker via WorkerManager.
   * The proxy calls `callWorkerStreamFunction()` which sends a `stream: true` call message
   * and yields `stream_chunk` messages from the worker as an AsyncIterable.
   */
  registerAsWorkerStreamFn<
    Input extends TaskInput = TaskInput,
    Output extends TaskOutput = TaskOutput,
  >(modelProvider: string, taskType: string) {
    const streamFn: AiProviderStreamFn<Input, Output> = async function* (
      input: Input,
      model: ModelConfig | undefined,
      signal: AbortSignal,
      outputSchema?: JsonSchema,
      sessionId?: string
    ) {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      yield* workerManager.callWorkerStreamFunction<StreamEvent<Output>>(
        modelProvider,
        taskType,
        [input, model, outputSchema, sessionId],
        { signal }
      );
    };
    this.registerStreamFn<Input, Output>(modelProvider, taskType, streamFn);
  }

  /**
   * Retrieves the streaming execution function for a task type and model provider.
   * Returns undefined if no streaming function is registered (fallback to non-streaming).
   */
  getStreamFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string
  ): AiProviderStreamFn<Input, Output> | undefined {
    const taskTypeMap = this.streamFnRegistry.get(taskType);
    return taskTypeMap?.get(modelProvider) as AiProviderStreamFn<Input, Output> | undefined;
  }

  /**
   * Registers a worker-proxied preview function for a specific task type and model provider.
   * Creates a proxy that delegates preview execution to a Web Worker via WorkerManager.
   * Returns undefined (non-throwing) if the worker has no preview function for the task type.
   */
  registerAsWorkerPreviewRunFn<
    Input extends TaskInput = TaskInput,
    Output extends TaskOutput = TaskOutput,
  >(modelProvider: string, taskType: string) {
    const previewFn: AiProviderPreviewRunFn<Input, Output> = async (
      input: Input,
      model: ModelConfig | undefined
    ) => {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      return workerManager.callWorkerPreviewFunction<Output>(modelProvider, taskType, [
        input,
        model,
      ]);
    };
    this.registerPreviewRunFn<Input, Output>(modelProvider, taskType, previewFn);
  }

  /**
   * Registers a preview execution function for a specific task type and model provider.
   * Called by AiTask.executePreview() to provide a fast, lightweight preview without a network call.
   */
  registerPreviewRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string,
    previewRunFn: AiProviderPreviewRunFn<Input, Output>
  ) {
    if (!this.previewRunFnRegistry.has(taskType)) {
      this.previewRunFnRegistry.set(taskType, new Map());
    }
    this.previewRunFnRegistry.get(taskType)!.set(modelProvider, previewRunFn);
  }

  /**
   * Retrieves the preview execution function for a task type and model provider.
   * Returns undefined if no preview function is registered (fallback to default behavior).
   */
  getPreviewRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string
  ): AiProviderPreviewRunFn<Input, Output> | undefined {
    const taskTypeMap = this.previewRunFnRegistry.get(taskType);
    return taskTypeMap?.get(modelProvider) as AiProviderPreviewRunFn<Input, Output> | undefined;
  }

  /**
   * Retrieves the direct execution function for a task type and model
   * Bypasses the job queue system for immediate execution
   */
  getDirectRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string
  ) {
    const taskTypeMap = this.runFnRegistry.get(taskType);
    const runFn = taskTypeMap?.get(modelProvider) as AiProviderRunFn<Input, Output> | undefined;
    if (!runFn) {
      const installedProviders = this.getInstalledProviderIds();
      const providersForTask = this.getProviderIdsForTask(taskType);
      const hint =
        providersForTask.length > 0
          ? ` Providers supporting "${taskType}": [${providersForTask.join(", ")}].`
          : installedProviders.length > 0
            ? ` Installed providers: [${installedProviders.join(", ")}] (none support "${taskType}").`
            : " No providers are registered. Call provider.register() before running AI tasks.";
      throw new Error(
        `No run function found for task type "${taskType}" and provider "${modelProvider}".${hint}`
      );
    }
    return runFn;
  }
}

// Singleton instance management for the ProviderRegistry
let providerRegistry: AiProviderRegistry = new AiProviderRegistry();
export function getAiProviderRegistry() {
  return providerRegistry;
}
export function setAiProviderRegistry(pr: AiProviderRegistry) {
  providerRegistry = pr;
}
