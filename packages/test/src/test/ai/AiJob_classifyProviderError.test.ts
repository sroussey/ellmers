/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  ImageGenerationContentPolicyError,
  ImageGenerationProviderError,
  ProviderUnsupportedFeatureError,
} from "@workglow/ai";
import { PermanentJobError, RetryableJobError } from "@workglow/job-queue";

describe("classifyProviderError mapping for image-generation errors", () => {
  it("maps ProviderUnsupportedFeatureError to PermanentJobError", () => {
    const err = new ProviderUnsupportedFeatureError("mask", "m", "not supported");
    const classified = classifyProviderError(err, "ImageGenerateTask", "TEST_PROVIDER");
    expect(classified).toBeInstanceOf(PermanentJobError);
  });

  it("maps ImageGenerationContentPolicyError to PermanentJobError", () => {
    const err = new ImageGenerationContentPolicyError("m", "violates policy");
    const classified = classifyProviderError(err, "ImageGenerateTask", "TEST_PROVIDER");
    expect(classified).toBeInstanceOf(PermanentJobError);
  });

  it("maps retryable ImageGenerationProviderError to RetryableJobError", () => {
    const err = new ImageGenerationProviderError("m", "rate limited");
    const classified = classifyProviderError(err, "ImageGenerateTask", "TEST_PROVIDER");
    expect(classified).toBeInstanceOf(RetryableJobError);
  });
});
