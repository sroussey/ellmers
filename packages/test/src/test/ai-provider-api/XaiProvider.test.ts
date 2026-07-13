/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { isStrictCompatibleSchema } from "@workglow/ai/provider-utils";
import { _testOnly } from "@workglow/xai/ai";
import { describe, expect, it } from "vitest";

const { XaiQueuedProvider, XAI_RUN_FN_SPECS, XAI_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "XAI",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("XaiQueuedProvider.inferCapabilities", () => {
  const provider = new XaiQueuedProvider(XAI_RUN_FNS);

  it("infers chat + tool-use + json-mode + vision-input for the grok-4 family", () => {
    const caps = provider.inferCapabilities(model("grok-4"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers chat capabilities (no vision) for grok-3-mini", () => {
    const caps = provider.inferCapabilities(model("grok-3-mini"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).not.toContain("vision-input");
  });

  it("infers vision-input for grok-2-vision", () => {
    const caps = provider.inferCapabilities(model("grok-2-vision-1212"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("vision-input");
  });

  it("infers image.generation (and not text.generation) for grok image models", () => {
    const caps = provider.inferCapabilities(model("grok-2-image-1212"));
    expect(caps).toContain("image.generation");
    expect(caps).not.toContain("text.generation");
    expect(caps).not.toContain("tool-use");
  });

  it("falls back to declared capabilities when the model id is unknown", () => {
    const caps = provider.inferCapabilities(
      model("totally-unknown-model", ["text.classification"])
    );
    expect(caps).toEqual(["text.classification"]);
  });

  it("falls back to a baseline of meta-ops when nothing matches and nothing is declared", () => {
    const caps = provider.inferCapabilities(model("totally-unknown-model"));
    expect(caps).toContain("model.search");
    expect(caps).toContain("model.info");
    expect(caps).not.toContain("text.generation");
  });

  it("infers full capability set for grok-4", () => {
    const caps = provider.inferCapabilities(model("grok-4"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual([
      "json-mode",
      "model.count-tokens",
      "model.info",
      "model.search",
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "vision-input",
    ]);
  });
});

describe("capability-set parity", () => {
  it("XAI_RUN_FN_SPECS matches XAI_RUN_FNS serves shapes", () => {
    const fnsServes = XAI_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = XAI_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("XAI_RUN_FNS shape", () => {
  it("registers a runFn for every capability set the provider claims to serve", () => {
    const sets = XAI_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("image.generation");
    expect(sets).toContain("model.count-tokens");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });

  it("tiebreaks `text.generation` to the smallest serves entry (plain text-gen)", () => {
    const candidates = XAI_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });
});

describe("isStrictCompatibleSchema wiring", () => {
  it("resolves the shared helper from @workglow/ai/provider-utils (parity with OpenAI)", () => {
    expect(typeof isStrictCompatibleSchema).toBe("function");
  });

  it("returns false for combinator schemas (anyOf/oneOf/allOf)", () => {
    expect(isStrictCompatibleSchema({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe(
      false
    );
  });

  it("returns true for an object with additionalProperties:false and all-required properties", () => {
    expect(
      isStrictCompatibleSchema({
        type: "object",
        additionalProperties: false,
        required: ["a"],
        properties: { a: { type: "string" } },
      })
    ).toBe(true);
  });
});
