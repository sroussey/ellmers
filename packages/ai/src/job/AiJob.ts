/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbortSignalJobError,
  IJobExecuteContext,
  Job,
  JobStatus,
  PermanentJobError,
  RetryableJobError,
  withJobErrorDiagnostics,
} from "@workglow/job-queue";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { JsonSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { collectStream } from "../capability/collectStream";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import {
  ImageGenerationContentPolicyError,
  ImageGenerationProviderError,
  ProviderUnsupportedFeatureError,
} from "../errors/ImageGenerationErrors";

/** Default timeout for provider API calls (2 minutes). */
const DEFAULT_AI_TIMEOUT_MS = 120_000;

/** Local inference (CPU/WASM) often needs several minutes (downloads, load, multi-turn tool follow-up). */
const LOCAL_INFERENCE_DEFAULT_TIMEOUT_MS = 300_000;

function resolveAiJobTimeoutMs(aiProvider: string, explicitMs: number | undefined): number {
  if (explicitMs !== undefined) {
    return explicitMs;
  }
  if (aiProvider === "LOCAL_LLAMACPP" || aiProvider === "HF_TRANSFORMERS_ONNX") {
    return LOCAL_INFERENCE_DEFAULT_TIMEOUT_MS;
  }
  return DEFAULT_AI_TIMEOUT_MS;
}

/**
 * Input data for the AiJob.
 *
 * `taskType` is retained as observability / queue-key metadata only — dispatch
 * resolves the run function via `requires` against the provider's capability-set
 * registrations. Both fields travel together so logs and queue keys remain stable
 * even though the registry is now keyed by capability sets.
 */
export interface AiJobInput<Input extends TaskInput = TaskInput> {
  taskType: string;
  /**
   * Capability set the job requires from the provider. The dispatcher passes
   * this to {@link AiProviderRegistry.getRunFnFor} to resolve a streaming run
   * function. An empty array matches the smallest registration available.
   */
  requires: readonly Capability[];
  aiProvider: string;
  taskInput: Input & { model: ModelConfig };
  /** JSON Schema for structured output, when the task declares x-structured-output. */
  outputSchema?: JsonSchema;
  /** Timeout in milliseconds for the provider API call. Defaults to 120s. */
  timeoutMs?: number;
  /** Opaque session token for multi-turn conversation caching (KV cache for local models, prompt caching for API providers). */
  sessionId?: string;
}

/**
 * Classifies a provider error as retryable or permanent based on known patterns.
 * Returns a RetryableJobError for transient issues (rate limits, network errors,
 * server errors) and a PermanentJobError for non-recoverable issues (auth, not found).
 */
export function classifyProviderError(err: unknown, taskType: string, provider: string): Error {
  if (
    err instanceof PermanentJobError ||
    err instanceof RetryableJobError ||
    err instanceof AbortSignalJobError
  ) {
    return err;
  }

  if (
    err instanceof ProviderUnsupportedFeatureError ||
    err instanceof ImageGenerationContentPolicyError
  ) {
    return new PermanentJobError(err.message);
  }
  if (err instanceof ImageGenerationProviderError) {
    return err.retryable ? new RetryableJobError(err.message) : new PermanentJobError(err.message);
  }

  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof (err as any)?.status === "number"
      ? (err as any).status
      : typeof (err as any)?.statusCode === "number"
        ? (err as any).statusCode
        : (() => {
            const m = message.match(/\b([45]\d{2})\b/);
            return m ? parseInt(m[1], 10) : undefined;
          })();

  // Check for abort/cancellation
  if (err instanceof Error && err.name === "AbortError") {
    return new AbortSignalJobError(
      withJobErrorDiagnostics(`Provider call aborted for ${taskType} (${provider})`, err)
    );
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return new AbortSignalJobError(
      withJobErrorDiagnostics(`Provider call timed out for ${taskType} (${provider})`, err)
    );
  }
  // Catch abort patterns re-thrown as plain Errors (e.g. "Pipeline download aborted" from HFT)
  if (
    message.includes("Pipeline download aborted") ||
    message.includes("Operation aborted") ||
    message.includes("operation was aborted") ||
    message.includes("The operation was aborted")
  ) {
    return new AbortSignalJobError(
      withJobErrorDiagnostics(
        `Provider call aborted for ${taskType} (${provider}): ${message}`,
        err
      )
    );
  }

  // Incomplete model cache (e.g. missing preprocessor_config.json) — let the queue retry
  // so the provider re-downloads missing files on the next attempt.
  // The "HFT_NULL_PROCESSOR:" prefix is produced by HFT_Pipeline.ts
  // (HFT_NULL_PROCESSOR_PREFIX constant) when an image processor fails to initialize.
  if (message.startsWith("HFT_NULL_PROCESSOR:")) {
    return new RetryableJobError(withJobErrorDiagnostics(message, err));
  }

  // Rate limiting (429) — retryable with backoff
  if (status === 429) {
    const retryAfterMatch = message.match(/retry.after[:\s]*(\d+)/i);
    const retryMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 30_000;
    return new RetryableJobError(
      withJobErrorDiagnostics(`Rate limited by ${provider} for ${taskType}: ${message}`, err),
      new Date(Date.now() + retryMs)
    );
  }

  // Auth errors (401, 403) — permanent
  if (status === 401 || status === 403) {
    return new PermanentJobError(
      withJobErrorDiagnostics(
        `Authentication failed for ${provider} (${taskType}): ${message}`,
        err
      )
    );
  }

  // Not found / invalid request (400, 404) — permanent
  if (status === 400 || status === 404) {
    return new PermanentJobError(
      withJobErrorDiagnostics(`Invalid request to ${provider} for ${taskType}: ${message}`, err)
    );
  }

  // Server errors (500, 502, 503, 529) — retryable
  if (status && status >= 500) {
    return new RetryableJobError(
      withJobErrorDiagnostics(
        `Server error from ${provider} for ${taskType} (HTTP ${status}): ${message}`,
        err
      )
    );
  }

  // Network errors — retryable
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    (err instanceof TypeError && message.includes("fetch"))
  ) {
    return new RetryableJobError(
      withJobErrorDiagnostics(`Network error calling ${provider} for ${taskType}: ${message}`, err)
    );
  }

  // Timeout errors — retryable
  if (message.includes("timed out") || message.includes("timeout")) {
    return new RetryableJobError(
      withJobErrorDiagnostics(`Timeout calling ${provider} for ${taskType}: ${message}`, err)
    );
  }

  // Default: treat unknown errors as permanent to avoid infinite retries
  return new PermanentJobError(
    withJobErrorDiagnostics(`Provider ${provider} failed for ${taskType}: ${message}`, err)
  );
}

/**
 * Extends the base Job class to provide custom execution functionality
 * through a provided function.
 */
export class AiJob<
  Input extends AiJobInput<TaskInput> = AiJobInput<TaskInput>,
  Output extends TaskOutput = TaskOutput,
> extends Job<Input, Output> {
  /**
   * Executes the job using the provided function.
   */
  override async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
    if (context.signal.aborted || this.status === JobStatus.ABORTING) {
      throw new AbortSignalJobError("Abort signal aborted before execution of job");
    }

    let abortHandler: (() => void) | undefined;

    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        const handler = () => {
          reject(new AbortSignalJobError("Abort signal seen, ending job"));
        };

        context.signal.addEventListener("abort", handler, { once: true });
        abortHandler = () => context.signal.removeEventListener("abort", handler);
      });

      const runFn = async () => {
        const fn = getAiProviderRegistry().getRunFnFor<Input["taskInput"], Output>(
          input.aiProvider,
          input.requires
        );
        if (!fn) {
          throw new Error(
            `No run function found for provider "${input.aiProvider}" serving capabilities ` +
              `[${input.requires.join(", ")}] (task: ${input.taskType}).`
          );
        }
        const model = input.taskInput.model;
        // Second abort check after resolving run function (covers async gap)
        if (context.signal.aborted) {
          throw new AbortSignalJobError("Job aborted");
        }

        // Apply timeout via AbortSignal.timeout combined with the caller's signal
        const timeoutMs = resolveAiJobTimeoutMs(input.aiProvider, input.timeoutMs);
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const combinedSignal = AbortSignal.any([context.signal, timeoutSignal]);

        // Streaming-only world: invoke the generator and collect via collectStream.
        // Non-streaming consumers (this method) get a single materialised Output;
        // streaming consumers go through executeStream() and bypass collectStream.
        const stream = fn(
          input.taskInput,
          model,
          combinedSignal,
          input.outputSchema,
          input.sessionId
        );
        return await collectStream<Output>(stream);
      };
      const runFnPromise = runFn();

      return await Promise.race([runFnPromise, abortPromise]);
    } catch (err) {
      throw classifyProviderError(err, input.taskType, input.aiProvider);
    } finally {
      // Clean up the abort event listener to prevent memory leaks
      if (abortHandler) {
        abortHandler();
      }
    }
  }

  /**
   * Streaming execution: yields StreamEvents from the provider's stream function.
   * Falls back to non-streaming execute() if no stream function is registered.
   *
   * On mid-stream errors, logs the failure and re-throws the classified error
   * without emitting a `finish` event — callers iterating the async iterable
   * detect termination via the thrown error rather than a synthetic finish.
   * Delta accumulation is the responsibility of the caller (e.g. TaskRunner).
   */
  async *executeStream(
    input: Input,
    context: IJobExecuteContext
  ): AsyncIterable<StreamEvent<Output>> {
    if (context.signal.aborted || this.status === JobStatus.ABORTING) {
      throw new AbortSignalJobError("Abort signal aborted before streaming execution of job");
    }

    const streamFn = getAiProviderRegistry().getRunFnFor<Input["taskInput"], Output>(
      input.aiProvider,
      input.requires
    );

    if (!streamFn) {
      const result = await this.execute(input, context);
      yield { type: "finish", data: result } as StreamEvent<Output>;
      return;
    }

    const model = input.taskInput.model;

    // Apply timeout via AbortSignal.timeout combined with the caller's signal
    const timeoutMs = resolveAiJobTimeoutMs(input.aiProvider, input.timeoutMs);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([context.signal, timeoutSignal]);

    try {
      yield* streamFn(input.taskInput, model, combinedSignal, input.outputSchema, input.sessionId);
    } catch (err) {
      const logger = getLogger();
      logger.warn(
        `AiJob: Stream error for ${input.taskType} (${input.aiProvider}): ${err instanceof Error ? err.message : String(err)}`
      );
      throw classifyProviderError(err, input.taskType, input.aiProvider);
    }
  }
}
