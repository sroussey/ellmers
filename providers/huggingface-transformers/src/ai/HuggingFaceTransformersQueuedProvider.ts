/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueuedAiProvider } from "@workglow/ai";
import type {
  IAiExecutionStrategy,
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  AiProviderRegisterOptions,
  AiProviderQueueConcurrency,
  ModelConfig,
} from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX, HF_TRANSFORMERS_ONNX_CPU } from "./common/HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";
import { deleteHftSession } from "./common/HFT_Pipeline";

const GPU_DEVICES = new Set(["webgpu", "gpu", "metal"]);

/** Default concurrent WASM/CPU ONNX jobs in production (ONNX Runtime / wasm backend). */
const HFT_CPU_QUEUE_CONCURRENCY_PRODUCTION = 4;

/**
 * When true, use a single worker for the CPU/WASM queue so tests do not contend on the
 * shared HF cache and ONNX wasm (Vitest, Jest, NODE_ENV=test, Bun test).
 */
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
 * Main-thread registration (inline or worker-backed).
 * WebGPU/GPU/Metal models use the `gpu` slot (or a numeric `queue.concurrency`, default 1).
 * WASM/CPU models use a separate {@link HF_TRANSFORMERS_ONNX_CPU} queue with higher
 * concurrency (4 in production, 1 under automated tests) to limit ONNX worker contention.
 * Set `cpu` in `queue.concurrency` to override the default.
 */
export class HuggingFaceTransformersQueuedProvider extends QueuedAiProvider<HfTransformersOnnxModelConfig> {
  readonly name = HF_TRANSFORMERS_ONNX;
  readonly displayName = "Hugging Face Transformers (ONNX)";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  private cpuStrategy: IAiExecutionStrategy | undefined;

  readonly taskTypes = [
    "AiChatTask",
    "DownloadModelTask",
    "UnloadModelTask",
    "ModelInfoTask",
    "CountTokensTask",
    "TextEmbeddingTask",
    "TextGenerationTask",
    "TextQuestionAnswerTask",
    "TextLanguageDetectionTask",
    "TextClassificationTask",
    "TextFillMaskTask",
    "TextNamedEntityRecognitionTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "TextTranslationTask",
    "ImageSegmentationTask",
    "ImageToTextTask",
    "BackgroundRemovalTask",
    "ImageEmbeddingTask",
    "ImageClassificationTask",
    "ObjectDetectionTask",
    "ToolCallingTask",
    "StructuredGenerationTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfTransformersOnnxModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    deleteHftSession(sessionId);
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
