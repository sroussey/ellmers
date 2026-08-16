/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { isCreditExhaustedError, runWithCreditSkip } from "../../contract/creditExhaustedSkip";

describe("isCreditExhaustedError", () => {
  it("recognizes HuggingFace Inference 402 included-credits exhaustion", () => {
    const err = Object.assign(
      new Error(
        "You have exceeded your monthly included credits for Inference Providers. Subscribe to PRO to get 20x more usage."
      ),
      { status: 402 }
    );
    expect(isCreditExhaustedError(err)).toBe(true);
  });

  it("recognizes OpenRouter 402 insufficient credits", () => {
    const err = Object.assign(new Error("Insufficient credits"), { status: 402 });
    expect(isCreditExhaustedError(err)).toBe(true);
  });

  it("recognizes Anthropic credit-balance-too-low (HTTP 400)", () => {
    expect(
      isCreditExhaustedError(
        new Error(
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
        )
      )
    ).toBe(true);
  });

  it("recognizes OpenAI insufficient_quota even when the status is 429", () => {
    const err = Object.assign(
      new Error("You exceeded your current quota, please check your plan and billing details."),
      { status: 429, code: "insufficient_quota" }
    );
    expect(isCreditExhaustedError(err)).toBe(true);
  });

  it("recognizes a classifyProviderError-wrapped 'no credits remaining' message", () => {
    expect(
      isCreditExhaustedError(new Error("Provider OPENAI failed: 400 no credits remaining"))
    ).toBe(true);
  });

  it("recognizes Payment Required without a numeric status", () => {
    expect(isCreditExhaustedError(new Error("Payment Required"))).toBe(true);
  });

  it("recognizes HTTP 402 in the message when status is not a field", () => {
    expect(isCreditExhaustedError(new Error("HF_INFERENCE lookup failed (HTTP 402)"))).toBe(true);
  });

  it("walks error.cause so an SDK wrapper still matches", () => {
    const cause = Object.assign(new Error("not enough credits"), { status: 402 });
    expect(isCreditExhaustedError(new Error("HF inference failed", { cause }))).toBe(true);
  });

  it("does not treat a TPM/RPM rate limit as credit exhaustion", () => {
    const err = Object.assign(new Error("Rate limit exceeded. Please retry later."), {
      status: 429,
      code: "rate_limit_exceeded",
    });
    expect(isCreditExhaustedError(err)).toBe(false);
  });

  it("does not match backpressure 'credit' wording", () => {
    expect(
      isCreditExhaustedError(
        new Error("Passthrough edge gate stalled for 1000ms without pull or credit progress.")
      )
    ).toBe(false);
  });

  it("does not match scoring 'partial credit' wording", () => {
    expect(
      isCreditExhaustedError(
        new Error("gives partial credit when the candidate finds only some roles")
      )
    ).toBe(false);
  });

  it("does not match a generic 400", () => {
    const err = Object.assign(new Error("invalid_request: temperature is not supported"), {
      status: 400,
    });
    expect(isCreditExhaustedError(err)).toBe(false);
  });

  it("does not treat a bare 402 in unrelated prose as credit exhaustion", () => {
    expect(isCreditExhaustedError(new Error("Item 402(c) compensation table"))).toBe(false);
  });
});

describe("runWithCreditSkip", () => {
  it("calls skip instead of rethrowing a credit error", async () => {
    const notes: string[] = [];
    await runWithCreditSkip({ skip: (note?: string) => notes.push(note ?? "") }, async () => {
      throw Object.assign(new Error("Insufficient credits"), { status: 402 });
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/credits/i);
  });

  it("rethrows a non-credit error", async () => {
    await expect(
      runWithCreditSkip({ skip: () => undefined }, async () => {
        throw new Error("model not found");
      })
    ).rejects.toThrow("model not found");
  });

  it("returns the body's result when nothing is thrown", async () => {
    const result = await runWithCreditSkip({ skip: () => undefined }, async () => 7);
    expect(result).toBe(7);
  });
});
