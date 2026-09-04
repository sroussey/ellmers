/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderQueueConcurrency,
  AiProviderRegisterOptions,
  AiProviderRunFnRegistration,
  Capability,
  IAiExecutionStrategy,
  ModelConfig,
  ModelPricing,
  ModelRecord,
} from "@workglow/ai";
import { FREE_LOCAL_PRICING, QueuedAiProvider } from "@workglow/ai";
import { hftWorkerRunFnSpecs, inferHftCapabilities } from "./common/HFT_Capabilities";
import { HF_TRANSFORMERS_ONNX, HF_TRANSFORMERS_ONNX_CPU } from "./common/HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";
import { disposeHftSessionViaRegistry } from "./common/HFT_SessionDispose";

const GPU_DEVICES = new Set(["webgpu", "gpu", "metal"]);

/** Default concurrent WASM/CPU ONNX jobs in production (ONNX Runtime / wasm backend). */
const HFT_CPU_QUEUE_CONCURRENCY_PRODUCTION = 4;

function hftIsAutomatedTestEnvironment(): boolean {
  if (typeof process === "undefined") {
    return false;
  }
  const e = process.env;
  return (
    e.VITEST === "true" ||
    e.NODE_ENV === "test" ||
    e.BUN_TEST === "1" ||
    e.JEST_WORKER_ID !== undefined
  );
}

function hftDefaultCpuQueueConcurrency(): number {
  return hftIsAutomatedTestEnvironment() ? 1 : HFT_CPU_QUEUE_CONCURRENCY_PRODUCTION;
}

function resolveHftCpuQueueConcurrency(
  concurrency: AiProviderQueueConcurrency | undefined,
  defaultCpu: () => number
): number {
  if (concurrency === undefined) {
    return defaultCpu();
  }
  if (typeof concurrency === "number") {
    return defaultCpu();
  }
  return concurrency.cpu ?? defaultCpu();
}

/**
 * Main-thread registration (inline or worker-backed) for the HFT provider.
 * WebGPU/GPU/Metal models use the `gpu` slot (or a numeric `queue.concurrency`,
 * default 1). WASM/CPU models use a separate {@link HF_TRANSFORMERS_ONNX_CPU}
 * queue with higher concurrency (4 in production, 1 under automated tests).
 */
export class HuggingFaceTransformersQueuedProvider extends QueuedAiProvider<HfTransformersOnnxModelConfig> {
  readonly name = HF_TRANSFORMERS_ONNX;
  readonly displayName = "Hugging Face Transformers (ONNX)";
  readonly isLocal = true;
  readonly supportsBrowser = true;
  readonly supportsServer = true;

  private cpuStrategy: IAiExecutionStrategy | undefined;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, HfTransformersOnnxModelConfig>[],
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferHftCapabilities(model);
  }

  override modelPricing(model?: ModelConfig): ModelPricing | undefined {
    if (model && model.provider !== this.name && !model.model_id?.startsWith("onnx:")) {
      return undefined;
    }
    return FREE_LOCAL_PRICING;
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return hftWorkerRunFnSpecs();
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    // In worker-backed registrations the session map lives in the worker;
    // dispatch through the registered ["session.dispose"] run-fn (a worker
    // proxy there) so the delete reaches the runtime that owns the tensors.
    await disposeHftSessionViaRegistry(this.name, sessionId);
  }

  protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
    await super.afterRegister(options);
    this.cpuStrategy = this.createQueuedStrategy(
      HF_TRANSFORMERS_ONNX_CPU,
      resolveHftCpuQueueConcurrency(options.queue?.concurrency, hftDefaultCpuQueueConcurrency),
      options
    );
  }

  protected override getStrategyForModel(model: ModelConfig): IAiExecutionStrategy {
    const device = (model as HfTransformersOnnxModelConfig).provider_config?.device;
    if (device && GPU_DEVICES.has(device)) {
      return this.queuedStrategy!;
    }
    return this.cpuStrategy!;
  }
}
