/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thrown synchronously from validateInput() when the requested model cannot
 * support a feature on the provided input (e.g., Gemini + mask, HF + multiple images).
 * Surfaces before any worker/queue dispatch.
 */
export class ProviderUnsupportedFeatureError extends Error {
  public readonly retryable = false;
  constructor(
    public readonly field: string,
    public readonly modelId: string,
    detail: string,
  ) {
    super(`Model "${modelId}" does not support input field "${field}": ${detail}`);
    this.name = "ProviderUnsupportedFeatureError";
  }
}

/**
 * Thrown when a provider returns a content-policy refusal (OpenAI moderation,
 * Gemini SAFETY block, HF NSFW filter). Non-retryable.
 */
export class ImageGenerationContentPolicyError extends Error {
  public readonly retryable = false;
  constructor(
    public readonly modelId: string,
    public readonly providerReason: string,
  ) {
    super(`Image generation refused by ${modelId}: ${providerReason}`);
    this.name = "ImageGenerationContentPolicyError";
  }
}

/**
 * Wraps any other provider failure (rate limits, transient 5xx, malformed responses).
 * Retryable per the existing job-queue retry policy.
 */
export class ImageGenerationProviderError extends Error {
  public readonly retryable = true;
  constructor(
    public readonly modelId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${modelId}: ${message}`, options);
    this.name = "ImageGenerationProviderError";
  }
}
