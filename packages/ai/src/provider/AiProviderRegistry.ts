/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { JsonSchema, ServiceRegistry } from "@workglow/util/worker";
import { createServiceToken, globalServiceRegistry, WORKER_MANAGER } from "@workglow/util/worker";
import type { AiEmit } from "../capability/AiEmit";
import type { Capability } from "../capability/Capabilities";
import { DirectExecutionStrategy } from "../execution/DirectExecutionStrategy";
import type { AiStrategyResolver, IAiExecutionStrategy } from "../execution/IAiExecutionStrategy";
import type { ModelConfig } from "../model/ModelSchema";
import type { AiProvider } from "./AiProvider";
import type { CheckpointPrefix } from "./CheckpointRegistry";

/**
 * Session/checkpoint context passed to provider run functions.
 *
 * - `sessionId`: session to use / rewind source. For checkpoint consumers this
 *   is the checkpoint id; state may live worker-side under this key.
 * - `emitCheckpointId`: pre-minted id the provider should snapshot post-turn
 *   state under at finish (local KV providers only; cloud providers annotate
 *   the final turn for server-side caching instead).
 * - `supersedeParent`: dispose `sessionId`'s worker-side state after a
 *   successful `emitCheckpointId` snapshot.
 * - `prefix`: resolved prefix content — cloud replay payload and local
 *   re-encode fallback. When present (and `ownedSession` is not set), run-fns
 *   must treat `sessionId` as an immutable checkpoint (never write back under
 *   it).
 * - `ownedSession`: `sessionId` is the caller's own mutable session (e.g. a
 *   chat's per-conversation id) that merely STARTS from `prefix` content.
 *   Local providers keep their normal progressive per-turn KV snapshotting
 *   under it — a checkpoint-seeded chat must never be slower than a plain
 *   one — instead of applying checkpoint immutability semantics.
 * - `seedCheckpointId`: for `ownedSession` consumers, the checkpoint id whose
 *   provider-side warmed state (server cache entry or local KV snapshot) can
 *   seed the session's first turn. Read-only: providers must never write back
 *   or dispose under this id — its lifecycle belongs to the checkpoint.
 */
export interface AiSessionContext {
  readonly sessionId?: string | undefined;
  readonly emitCheckpointId?: string | undefined;
  readonly supersedeParent?: boolean | undefined;
  readonly prefix?: CheckpointPrefix | undefined;
  readonly ownedSession?: boolean | undefined;
  readonly seedCheckpointId?: string | undefined;
}

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
 * Promise+emit run-fn shape. Output flows through `emit`; the Promise carries
 * no data and signals completion only. For one-shot capabilities the run-fn
 * emits a single `finish` event whose `data` carries the result. For streaming
 * capabilities the run-fn emits delta events and ends with an empty `finish`.
 * The run-fn MUST NOT accumulate — accumulation lives only at terminal
 * consumer sites (`AiTask.execute`, `StreamProcessor` `ctx.shouldAccumulate`).
 */
export type AiProviderRunFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (
  input: Input,
  model: Model | undefined,
  signal: AbortSignal,
  emit: AiEmit<Output>,
  outputSchema?: JsonSchema,
  session?: AiSessionContext
) => Promise<void>;

/**
 * A capability-set registration for a provider Promise+emit run function.
 *
 * `serves` is the closed set of {@link Capability} values that the run function can
 * fulfil in a single invocation. The dispatcher matches a task's `requires` array
 * against `serves` using superset semantics (`requires.every(r => serves.includes(r))`)
 * and selects the most-specific match (smallest `serves` length wins, ties broken by
 * registration order).
 *
 * Example:
 * ```ts
 * { serves: ["text.generation"], runFn: runPlainGeneration }
 * { serves: ["text.generation", "tool-use"], runFn: runGenerationWithTools }
 * ```
 *
 * A `requires: ["text.generation"]` lookup picks the plain entry; a
 * `requires: ["text.generation", "tool-use"]` lookup picks the tool-aware one.
 */
export interface AiProviderRunFnRegistration<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> {
  readonly serves: readonly Capability[];
  readonly runFn: AiProviderRunFn<Input, Output, Model>;
}

/**
 * Build the deterministic key used to register a `serves` set on a worker server
 * and to dispatch worker calls to it. Sorted alphabetically + comma-joined so the
 * key is stable across registrations and worker boundaries.
 *
 * Example: `["tool-use", "text.generation"]` → `"text.generation,tool-use"`.
 */
export function workerKeyForServes(serves: readonly Capability[]): string {
  return [...serves].sort().join(",");
}

/**
 * Registry that manages provider-specific task execution functions and job queues.
 */
export class AiProviderRegistry {
  /**
   * All capability-set registrations grouped by provider name. Each provider may
   * register multiple registrations whose `serves` sets cover different capability
   * combinations; lookup picks the most-specific superset of `requires`.
   */
  private readonly runFnsByProvider: Map<string, AiProviderRunFnRegistration<any, any>[]> =
    new Map();
  private readonly previewRunFnRegistry: Map<
    string,
    Map<string, AiProviderPreviewRunFn<any, any>>
  > = new Map();
  private readonly providers: Map<string, AiProvider<any>> = new Map();
  private readonly strategyResolvers: Map<string, AiStrategyResolver> = new Map();
  private defaultStrategy: IAiExecutionStrategy | undefined;

  registerProvider(provider: AiProvider<any>): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Removes a previously registered provider and all of its run/stream/preview functions.
   * Used for cleanup when provider initialization fails partway through.
   */
  unregisterProvider(name: string): void {
    this.providers.delete(name);
    this.strategyResolvers.delete(name);
    this.runFnsByProvider.delete(name);
    for (const [, providerMap] of this.previewRunFnRegistry) {
      providerMap.delete(name);
    }
  }

  getProvider(name: string): AiProvider<any> | undefined {
    return this.providers.get(name);
  }

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
   * Stable-sorted provider ids whose registry contains at least one registration
   * whose `serves` set is a superset of `requires`. Use this when the UI or
   * validation should only offer providers that can execute a particular
   * capability set (e.g. {@link ModelSearchTask}).
   */
  getProviderIdsForCapabilities(requires: readonly Capability[]): string[] {
    const out: string[] = [];
    for (const [providerName, regs] of this.runFnsByProvider) {
      if (regs.some((r) => requires.every((cap) => r.serves.includes(cap)))) {
        out.push(providerName);
      }
    }
    return out.sort();
  }

  /**
   * Registers a Promise+emit run function under a capability-set for the given
   * provider. Multiple registrations per provider are supported -- dispatch
   * picks the smallest `serves` set that is a superset of the task's `requires`.
   *
   * @param providerName - The provider name (e.g., "OPENAI")
   * @param registration - `{ serves, runFn }` describing what this run function fulfils
   */
  registerRunFn(providerName: string, registration: AiProviderRunFnRegistration): void {
    this.registerRunFnInternal(providerName, registration);
  }

  private registerRunFnInternal(
    providerName: string,
    registration: AiProviderRunFnRegistration
  ): void {
    const list = this.runFnsByProvider.get(providerName);
    if (list) {
      list.push(registration);
    } else {
      this.runFnsByProvider.set(providerName, [registration]);
    }
  }

  /**
   * Registers a worker-proxied run function under a capability-set.
   * Delegates via `WorkerManager.callWorkerRunFunction` keyed by
   * {@link workerKeyForServes}(serves). `serves` must match the worker-side
   * registration's `serves` exactly so the deterministic
   * `workerKeyForServes` lookup resolves on both sides.
   */
  registerAsWorkerRunFn(providerName: string, serves: readonly Capability[]): void {
    const key = workerKeyForServes(serves);
    const proxy: AiProviderRunFn = async (
      input: TaskInput,
      model: ModelConfig | undefined,
      signal: AbortSignal,
      emit: AiEmit,
      outputSchema?: JsonSchema,
      session?: AiSessionContext
    ): Promise<void> => {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      await workerManager.callWorkerRunFunction<StreamEvent<TaskOutput>>(
        providerName,
        key,
        [input, model, outputSchema, session],
        { signal, emit }
      );
    };
    this.registerRunFnInternal(providerName, { serves, runFn: proxy });
  }

  /**
   * Resolves a registered run function for `providerName` whose `serves` set
   * is a superset of `requires`. When multiple registrations match, the
   * most-specific one wins (smallest `serves.length`); ties are broken by
   * registration order.
   *
   * Empty `requires` matches every registration; the first registered (smallest
   * after the stable sort) is returned.
   *
   * @returns The run function, or `undefined` if no registration matches.
   */
  getRunFnFor<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    providerName: string,
    requires: readonly Capability[]
  ): AiProviderRunFn<Input, Output> | undefined {
    const list = this.runFnsByProvider.get(providerName);
    if (!list || list.length === 0) {
      return undefined;
    }
    const matches: { reg: AiProviderRunFnRegistration<any, any>; index: number }[] = [];
    for (let i = 0; i < list.length; i++) {
      const reg = list[i];
      if (requires.every((cap) => reg.serves.includes(cap))) {
        matches.push({ reg, index: i });
      }
    }
    if (matches.length === 0) return undefined;
    // Stable sort: smallest serves length first; preserve registration order on tie.
    matches.sort((a, b) => {
      const lenDiff = a.reg.serves.length - b.reg.serves.length;
      if (lenDiff !== 0) return lenDiff;
      return a.index - b.index;
    });
    return matches[0].reg.runFn as AiProviderRunFn<Input, Output>;
  }

  /**
   * Returns the raw list of registrations for a provider (for diagnostics and
   * tests). Returns an empty array when the provider has none.
   */
  getRunFnRegistrations(providerName: string): readonly AiProviderRunFnRegistration<any, any>[] {
    return this.runFnsByProvider.get(providerName) ?? [];
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
}

export const AI_PROVIDER_REGISTRY = createServiceToken<AiProviderRegistry>("ai.provider.registry");

/**
 * Returns the AI provider registry from the given registry (defaults to global).
 * Lazy-registers a fresh `AiProviderRegistry` if the token is absent — same
 * pattern as `getLogger`. Makes scoped registries safe to use without an
 * explicit `registerAiProviderDefaults(registry)` call.
 */
export function getAiProviderRegistry(
  registry: ServiceRegistry = globalServiceRegistry
): AiProviderRegistry {
  if (!registry.has(AI_PROVIDER_REGISTRY)) {
    registerAiProviderDefaults(registry);
  }
  return registry.get(AI_PROVIDER_REGISTRY);
}

export function setAiProviderRegistry(
  pr: AiProviderRegistry,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(AI_PROVIDER_REGISTRY, pr);
}

/**
 * Registers the AI provider registry default factory on the given registry.
 * Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerAiProviderDefaults(
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(
    AI_PROVIDER_REGISTRY,
    (): AiProviderRegistry => new AiProviderRegistry(),
    true
  );
}

registerAiProviderDefaults();
