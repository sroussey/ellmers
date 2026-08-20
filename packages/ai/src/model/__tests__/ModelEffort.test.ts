/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  MODEL_EFFORTS,
  effortPlaceholder,
  enabledEffortsForModel,
  isModelEffort,
  isModelEffortEnabled,
  readEffortOptions,
  sanitizeEffortOptions,
  stampEffortOptions,
} from "../ModelEffort";

describe("ModelEffort", () => {
  it("lists none through ultra", () => {
    expect([...MODEL_EFFORTS]).toEqual(["none", "low", "medium", "high", "extra", "ultra"]);
  });

  it("isModelEffort accepts only known values", () => {
    expect(isModelEffort("high")).toBe(true);
    expect(isModelEffort("off")).toBe(false);
    expect(isModelEffort("xhigh")).toBe(false);
    expect(isModelEffort(undefined)).toBe(false);
  });
});

describe("sanitizeEffortOptions", () => {
  it("drops unknown entries and keeps order of valid ones", () => {
    expect(sanitizeEffortOptions(["high", "nope", "low"])).toEqual(["high", "low"]);
  });

  it("returns [] for an empty array and undefined for a non-array", () => {
    expect(sanitizeEffortOptions([])).toEqual([]);
    expect(sanitizeEffortOptions("high")).toBeUndefined();
  });
});

describe("readEffortOptions", () => {
  it("returns undefined when the key is omitted so callers ask the provider", () => {
    expect(readEffortOptions({})).toBeUndefined();
  });

  it("treats a present key as authoritative, including [] after filtering junk", () => {
    expect(readEffortOptions({ effort_options: [] })).toEqual([]);
    expect(readEffortOptions({ effort_options: ["bogus"] })).toEqual([]);
    expect(readEffortOptions({ effort_options: ["medium"] })).toEqual(["medium"]);
  });
});

describe("stampEffortOptions", () => {
  it("leaves the record unchanged when the provider has no policy", () => {
    const record = { title: "x" };
    expect(stampEffortOptions(record, undefined)).toEqual(record);
    expect("effort_options" in stampEffortOptions(record, undefined)).toBe(false);
  });

  it("copies supported, including []", () => {
    expect(
      stampEffortOptions({ title: "x" }, { supported: ["low", "high"], default: "low" })
        .effort_options
    ).toEqual(["low", "high"]);
    expect(stampEffortOptions({}, { supported: [], default: undefined }).effort_options).toEqual(
      []
    );
  });
});

describe("enabledEffortsForModel", () => {
  const policy = { supported: [...MODEL_EFFORTS], default: "medium" as const };

  it("prefers a present effort_options key over policy", () => {
    expect(enabledEffortsForModel({ effort_options: ["high"] }, policy)).toEqual(["high"]);
    expect(enabledEffortsForModel({ effort_options: [] }, policy)).toEqual([]);
  });

  it("falls back to policy.supported, or undefined when neither exists", () => {
    expect(enabledEffortsForModel({}, policy)).toEqual([...MODEL_EFFORTS]);
    expect(enabledEffortsForModel({}, undefined)).toBeUndefined();
  });
});

describe("isModelEffortEnabled", () => {
  const policy = { supported: ["low", "high"] as const, default: "low" as const };

  it("is false when effort is unset or the enabled list excludes it", () => {
    expect(isModelEffortEnabled({}, policy)).toBe(false);
    expect(isModelEffortEnabled({ effort: "medium" }, policy)).toBe(false);
    expect(isModelEffortEnabled({ effort: "high", effort_options: [] }, policy)).toBe(false);
    expect(isModelEffortEnabled({ effort: "high" }, { supported: [], default: undefined })).toBe(
      false
    );
  });

  it("is true when effort is in the enabled list, or when nothing restricts it", () => {
    expect(isModelEffortEnabled({ effort: "high" }, policy)).toBe(true);
    expect(isModelEffortEnabled({ effort: "ultra" }, undefined)).toBe(true);
  });
});

describe("effortPlaceholder", () => {
  it("names the class default when known", () => {
    expect(effortPlaceholder({ supported: MODEL_EFFORTS, default: "none" })).toBe("Default: none");
    expect(effortPlaceholder({ supported: MODEL_EFFORTS, default: undefined })).toBe("Default");
    expect(effortPlaceholder(undefined)).toBe("Default");
  });
});
