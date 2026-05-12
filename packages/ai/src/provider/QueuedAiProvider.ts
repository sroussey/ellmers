/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueuedExecutionStrategy } from "../execution/QueuedExecutionStrategy";
import type { IAiExecutionStrategy } from "../execution/IAiExecutionStrategy";
import type { ModelConfig } from "../model/ModelSchema";
import { AiProvider, resolveAiProviderGpuQueueConcurrency } from "./AiProvider";
import type { AiProviderRegisterOptions } from "./AiProvider";
import { getAiProviderRegistry } from "./AiProviderRegistry";

/**
 * AI provider base that registers a {@link QueuedExecutionStrategy} for
 * GPU-bound providers that need serialized access to hardware resources.
 *
 * Subclasses can override {@link getStrategyForModel} to make the decision
 * model-aware (e.g., HFT returns queued for WebGPU but direct for WASM).
 *
 * When `queue.autoCreate` is `false` (default: `true`), the strategy resolver
 * is still registered but the queue is not auto-created — execution will succeed
 * only if a matching queue was pre-registered in the {@link TaskQueueRegistry}.
 *
 * Web worker entrypoints should use a provider that extends {@link AiProvider} only
 * (no queue / storage), so bundles for `registerOnWorkerServer` stay lean.
 */
export abstract class QueuedAiProvider<
  TModelConfig extends ModelConfig = ModelConfig,
> extends AiProvider<TModelConfig> {
  protected queuedStrategy: QueuedExecutionStrategy | undefined;

  protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
    this.queuedStrategy = new QueuedExecutionStrategy(
      resolveAiProviderGpuQueueConcurrency(options.queue?.concurrency)
    );
    getAiProviderRegistry().registerStrategyResolver(this.name, (model) =>
      this.getStrategyForModel(model)
    );
  }

  /**
   * Helper to create a {@link QueuedExecutionStrategy}.
   */
  protected createQueuedStrategy(
    _queueName: string,
    concurrency: number,
    _options: AiProviderRegisterOptions
  ): QueuedExecutionStrategy {
    return new QueuedExecutionStrategy(concurrency);
  }

  /**
   * Returns the execution strategy for a given model. By default, always
   * returns the queued strategy. Subclasses can override to make this
   * model-dependent (e.g., HFT checks `provider_config.device`).
   */
  protected getStrategyForModel(_model: ModelConfig): IAiExecutionStrategy {
    return this.queuedStrategy!;
  }
}
