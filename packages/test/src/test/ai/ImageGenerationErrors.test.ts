/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  ImageGenerationContentPolicyError,
  ImageGenerationProviderError,
  ProviderUnsupportedFeatureError,
} from "@workglow/ai";

describe("ImageGenerationErrors", () => {
  it("ProviderUnsupportedFeatureError carries field and modelId", () => {
    const err = new ProviderUnsupportedFeatureError("mask", "google/gemini-2.5-flash-image", "mask is not supported");
    expect(err.field).toBe("mask");
    expect(err.modelId).toBe("google/gemini-2.5-flash-image");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("mask");
    expect(err.message).toContain("google/gemini-2.5-flash-image");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProviderUnsupportedFeatureError");
    expect(err.message).toBe(`Model "google/gemini-2.5-flash-image" does not support input field "mask": mask is not supported`);
  });

  it("ImageGenerationContentPolicyError carries provider reason and is non-retryable", () => {
    const err = new ImageGenerationContentPolicyError("openai/gpt-image-2", "violates safety policy");
    expect(err.providerReason).toBe("violates safety policy");
    expect(err.retryable).toBe(false);
    expect(err.modelId).toBe("openai/gpt-image-2");
    expect(err.name).toBe("ImageGenerationContentPolicyError");
    expect(err.message).toBe(`Image generation refused by openai/gpt-image-2: violates safety policy`);
  });

  it("ImageGenerationProviderError defaults to retryable", () => {
    const err = new ImageGenerationProviderError("openai/gpt-image-2", "rate limited", { cause: new Error("429") });
    expect(err.retryable).toBe(true);
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.modelId).toBe("openai/gpt-image-2");
    expect(err.name).toBe("ImageGenerationProviderError");
    expect(err.message).toBe(`openai/gpt-image-2: rate limited`);
  });
});
