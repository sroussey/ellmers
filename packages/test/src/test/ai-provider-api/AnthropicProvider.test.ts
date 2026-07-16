/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { ANTHROPIC_FALLBACK, _testOnly } from "@workglow/anthropic/ai";
import { describe, expect, it } from "vitest";

const { AnthropicQueuedProvider, ANTHROPIC_RUN_FN_SPECS, ANTHROPIC_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "ANTHROPIC",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("AnthropicQueuedProvider.inferCapabilities", () => {
  const provider = new AnthropicQueuedProvider(ANTHROPIC_RUN_FNS);

  it("infers full capabilities for claude-3-5-sonnet family", () => {
    const caps = provider.inferCapabilities(model("claude-3-5-sonnet-20241022"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
    expect(caps).toContain("text.rewriter");
    expect(caps).toContain("text.summary");
  });

  it("infers full capabilities for claude-sonnet-4 (Claude 4-series)", () => {
    const caps = provider.inferCapabilities(model("claude-sonnet-4-20250514"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers full capabilities for claude-opus-4 (Claude 4-series)", () => {
    const caps = provider.inferCapabilities(model("claude-opus-4-20250514"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers full capabilities for claude-haiku-4 (Claude 4-series)", () => {
    const caps = provider.inferCapabilities(model("claude-haiku-4-20250514"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it.each(["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5"])(
    "infers full capabilities for %s (Claude 5 family)",
    (id) => {
      const caps = provider.inferCapabilities(model(id));
      expect(caps).toContain("text.generation");
      expect(caps).toContain("tool-use");
      expect(caps).toContain("json-mode");
      expect(caps).toContain("vision-input");
      expect(caps).toContain("model.count-tokens");
    }
  );

  it("keeps claude-opus-4-7 / 4-8 on the Claude 4-series branch", () => {
    for (const id of ["claude-opus-4-7", "claude-opus-4-8"]) {
      const caps = provider.inferCapabilities(model(id));
      expect(caps).toContain("text.generation");
      expect(caps).toContain("vision-input");
    }
  });

  it("infers full capabilities for claude-3-haiku family", () => {
    const caps = provider.inferCapabilities(model("claude-3-haiku-20240307"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers full capabilities for claude-3-5-haiku (3.5 family)", () => {
    // Regression for the regex gap that previously matched only ...-sonnet.
    const caps = provider.inferCapabilities(model("claude-3-5-haiku-20241022"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers full capabilities for claude-3-opus family", () => {
    const caps = provider.inferCapabilities(model("claude-3-opus-20240229"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
  });

  it("does NOT infer image.generation or text.embedding for any Claude model", () => {
    for (const id of [
      "claude-3-5-sonnet-20241022",
      "claude-sonnet-4-20250514",
      "claude-3-haiku-20240307",
    ]) {
      const caps = provider.inferCapabilities(model(id));
      expect(caps).not.toContain("image.generation");
      expect(caps).not.toContain("image.editing");
      expect(caps).not.toContain("text.embedding");
    }
  });

  it("falls back to declared capabilities when model id is unknown", () => {
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

  // Exact-set assertions — these must match precisely (sorted).
  it("infers exact capability set for claude-3-5-sonnet-20241022", () => {
    const caps = provider.inferCapabilities(model("claude-3-5-sonnet-20241022"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual([
      "cache.checkpoint",
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

  it("infers exact capability set for claude-sonnet-4-20250514", () => {
    const caps = provider.inferCapabilities(model("claude-sonnet-4-20250514"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual([
      "cache.checkpoint",
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

describe("ANTHROPIC_FALLBACK", () => {
  const provider = new AnthropicQueuedProvider(ANTHROPIC_RUN_FNS);

  // mapModelList emits `capabilities: []`, so a fallback model is only usable
  // if inference recognizes its id. An unrecognized id yields meta-ops only.
  it("every fallback model infers text.generation", () => {
    expect(ANTHROPIC_FALLBACK.length).toBeGreaterThan(0);
    for (const entry of ANTHROPIC_FALLBACK) {
      expect(provider.inferCapabilities(model(entry.value)), entry.value).toContain(
        "text.generation"
      );
    }
  });

  it("does not offer retired model ids", () => {
    const values = ANTHROPIC_FALLBACK.map((entry) => entry.value);
    expect(values).not.toContain("claude-3-5-sonnet-20241022");
    expect(values).not.toContain("claude-3-5-haiku-20241022");
  });
});

describe("capability-set parity", () => {
  it("ANTHROPIC_RUN_FN_SPECS matches ANTHROPIC_RUN_FNS serves shapes", () => {
    const fnsServes = ANTHROPIC_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = ANTHROPIC_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("ANTHROPIC_RUN_FNS shape", () => {
  it("registers a runFn for every capability set the provider claims to serve", () => {
    const sets = ANTHROPIC_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    // Spot-check all canonical capability sets are present.
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("model.count-tokens");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });

  it("tiebreaks `text.generation` to the smallest serves entry (plain text-gen)", () => {
    const candidates = ANTHROPIC_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    // At least one entry of size 1 should exist for plain text generation.
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });

  it("does NOT register embeddings, image generation, or image editing", () => {
    const sets = ANTHROPIC_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).not.toContain("text.embedding");
    expect(sets).not.toContain("image.generation");
    expect(sets).not.toContain("image.editing");
  });
});
