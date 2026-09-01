/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ModelEffort } from "../ModelEffort";
import {
  EFFORT_POLICY_ALL,
  EFFORT_POLICY_NONE,
  MODEL_EFFORTS,
  effortPlaceholder,
  enabledEffortsForModel,
  isModelEffort,
  makeEffortPolicy,
  readEffortOptions,
  readModelName,
  resolveEnabledEffort,
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

describe("resolveEnabledEffort", () => {
  const policy = { supported: ["low", "high"] as const, default: "low" as const };

  it("is undefined when effort is unset, unknown, or the enabled list excludes it", () => {
    expect(resolveEnabledEffort(undefined, policy)).toBeUndefined();
    expect(resolveEnabledEffort({}, policy)).toBeUndefined();
    expect(resolveEnabledEffort({ effort: "xhigh" }, policy)).toBeUndefined();
    expect(resolveEnabledEffort({ effort: "medium" }, policy)).toBeUndefined();
    expect(resolveEnabledEffort({ effort: "high", effort_options: [] }, policy)).toBeUndefined();
    expect(resolveEnabledEffort({ effort: "high" }, EFFORT_POLICY_NONE)).toBeUndefined();
  });

  it("returns the effort itself when enabled, or when nothing restricts it", () => {
    expect(resolveEnabledEffort({ effort: "high" }, policy)).toBe("high");
    expect(resolveEnabledEffort({ effort: "ultra" }, undefined)).toBe("ultra");
  });

  // The point of returning the value: a caller indexes its own map with it and
  // needs no `as ModelEffort` to do so.
  it("narrows to ModelEffort so callers need no cast", () => {
    const effort = resolveEnabledEffort({ effort: "low" }, policy);
    const budgets: Record<ModelEffort, number> = {
      none: 0,
      low: 1,
      medium: 2,
      high: 3,
      extra: 4,
      ultra: 5,
    };
    expect(effort === undefined ? -1 : budgets[effort]).toBe(1);
  });
});

describe("readModelName", () => {
  it("trims the provider-side id and reads an absent one as empty", () => {
    expect(readModelName({ provider_config: { model_name: "  gpt-5  " } })).toBe("gpt-5");
    expect(readModelName({ provider_config: {} })).toBe("");
    expect(readModelName({})).toBe("");
    expect(readModelName(undefined)).toBe("");
  });
});

describe("makeEffortPolicy", () => {
  const REASONING = { supported: MODEL_EFFORTS, default: "medium" } as const;
  const policy = makeEffortPolicy({
    rules: [
      { when: /^text-embedding/i, policy: EFFORT_POLICY_NONE },
      { when: [/^gpt-5/i, (id) => id.startsWith("o3")], policy: REASONING },
    ],
    fallback: EFFORT_POLICY_ALL,
  });

  it("takes the first matching rule, by regex or predicate", () => {
    expect(policy({ provider_config: { model_name: "text-embedding-3-small" } })).toEqual(
      EFFORT_POLICY_NONE
    );
    expect(policy({ provider_config: { model_name: "gpt-5.6-sol" } })).toEqual(REASONING);
    expect(policy({ provider_config: { model_name: "o3-mini" } })).toEqual(REASONING);
  });

  // The asymmetry this replaces: an absent id answered "every level" while an
  // unrecognized one answered "none", two different claims from the same
  // amount of knowledge.
  it("answers an absent id and an unrecognized one with the same fallback", () => {
    expect(policy({ provider_config: { model_name: "brand-new-model" } })).toEqual(
      EFFORT_POLICY_ALL
    );
    expect(policy({ provider_config: { model_name: "" } })).toEqual(EFFORT_POLICY_ALL);
    expect(policy({})).toEqual(EFFORT_POLICY_ALL);
    expect(policy(undefined)).toEqual(EFFORT_POLICY_ALL);
  });

  it("carries a restrictive fallback just as faithfully", () => {
    const strict = makeEffortPolicy({
      rules: [{ when: /^grok/i, policy: REASONING }],
      fallback: EFFORT_POLICY_NONE,
    });
    expect(strict({ provider_config: { model_name: "grok-4" } })).toEqual(REASONING);
    expect(strict({ provider_config: { model_name: "llama-3" } })).toEqual(EFFORT_POLICY_NONE);
    expect(strict(undefined)).toEqual(EFFORT_POLICY_NONE);
  });
});

describe("effortPlaceholder", () => {
  it("names the class default when known", () => {
    expect(effortPlaceholder({ supported: MODEL_EFFORTS, default: "none" })).toBe("Default: none");
    expect(effortPlaceholder({ supported: MODEL_EFFORTS, default: undefined })).toBe("Default");
    expect(effortPlaceholder(undefined)).toBe("Default");
  });
});
