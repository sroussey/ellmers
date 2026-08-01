/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assertToolChoiceHonored,
  DeepSeekToolChoiceNotHonoredError,
  isForcingToolChoice,
} from "@workglow/deepseek/ai";
import { RetryableJobError } from "@workglow/job-queue";
import { describe, expect, it } from "vitest";

describe("isForcingToolChoice", () => {
  it("returns false for undefined, auto, and none", () => {
    expect(isForcingToolChoice(undefined)).toBe(false);
    expect(isForcingToolChoice("auto")).toBe(false);
    expect(isForcingToolChoice("none")).toBe(false);
  });

  it("returns true for required and a named function", () => {
    expect(isForcingToolChoice("required")).toBe(true);
    expect(isForcingToolChoice("get_weather")).toBe(true);
  });
});

describe("assertToolChoiceHonored", () => {
  it("throws DeepSeekToolChoiceNotHonoredError when required and no calls were made", () => {
    expect(() => assertToolChoiceHonored("required", [], "m")).toThrow(
      DeepSeekToolChoiceNotHonoredError
    );
  });

  it("does not throw when required and at least one valid call was made", () => {
    expect(() => assertToolChoiceHonored("required", ["get_weather"], "m")).not.toThrow();
  });

  it("throws with a diagnostic message when a named function was not called", () => {
    let caught: unknown;
    try {
      assertToolChoiceHonored("get_weather", ["send_email"], "m");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DeepSeekToolChoiceNotHonoredError);
    const message = (caught as Error).message;
    expect(message).toContain('expected a call to "get_weather"');
    expect(message).toContain("called: send_email");
  });

  it("throws an error that is an instance of RetryableJobError", () => {
    let caught: unknown;
    try {
      assertToolChoiceHonored("required", [], "m");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RetryableJobError);
  });
});
