/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  lowercaseTransform,
  substringTransform,
  truncateTransform,
  uppercaseTransform,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("uppercase", () => {
  it("uppercases strings", async () => {
    expect(await uppercaseTransform.apply("Hello", {})).toBe("HELLO");
  });
  it("inferOutputSchema returns string", () => {
    expect(uppercaseTransform.inferOutputSchema({ type: "string" } as DataPortSchema, {})).toEqual({
      type: "string",
    });
  });
});

describe("lowercase", () => {
  it("lowercases strings", async () => {
    expect(await lowercaseTransform.apply("HELLO", {})).toBe("hello");
  });
});

describe("truncate", () => {
  it("truncates to max length", async () => {
    expect(await truncateTransform.apply("hello world", { max: 5 })).toBe("hello");
  });
  it("leaves short strings alone", async () => {
    expect(await truncateTransform.apply("hi", { max: 5 })).toBe("hi");
  });
});

describe("substring", () => {
  it("substrings with start only", async () => {
    expect(await substringTransform.apply("hello", { start: 2, end: undefined })).toBe("llo");
  });
  it("substrings with start and end", async () => {
    expect(await substringTransform.apply("hello", { start: 1, end: 4 })).toBe("ell");
  });
});
