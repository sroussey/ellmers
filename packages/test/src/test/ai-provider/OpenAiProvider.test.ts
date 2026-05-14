/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { _testOnly } from "@workglow/openai/ai";
import { describe, expect, it } from "vitest";

const { OpenAiQueuedProvider, OPENAI_RUN_FN_SPECS, OPENAI_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "OPENAI",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("OpenAiQueuedProvider.inferCapabilities", () => {
  const provider = new OpenAiQueuedProvider(OPENAI_RUN_FNS);

  it("infers chat + tool-use + json-mode + vision-input for gpt-4o family", () => {
    const caps = provider.inferCapabilities(model("gpt-4o-mini"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers chat capabilities (no vision) for gpt-3.5-turbo", () => {
    const caps = provider.inferCapabilities(model("gpt-3.5-turbo"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).not.toContain("vision-input");
  });

  it("infers chat capabilities for the o1/o3 reasoning families", () => {
    const o1 = provider.inferCapabilities(model("o1-mini"));
    expect(o1).toContain("text.generation");
    const o3 = provider.inferCapabilities(model("o3"));
    expect(o3).toContain("text.generation");
    expect(o3).toContain("tool-use");
  });

  it("infers text.embedding (and not text.generation) for text-embedding-* models", () => {
    const caps = provider.inferCapabilities(model("text-embedding-3-small"));
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
    expect(caps).not.toContain("tool-use");
  });

  it("infers image.generation only for dall-e models", () => {
    const caps = provider.inferCapabilities(model("dall-e-3"));
    expect(caps).toContain("image.generation");
    expect(caps).not.toContain("image.editing");
    expect(caps).not.toContain("text.generation");
  });

  it("infers both image.generation and image.editing for gpt-image models", () => {
    const caps = provider.inferCapabilities(model("gpt-image-2"));
    expect(caps).toContain("image.generation");
    expect(caps).toContain("image.editing");
    expect(caps).not.toContain("text.generation");
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

  it("infers full capability set for gpt-4o-mini", () => {
    const caps = provider.inferCapabilities(model("gpt-4o-mini"));
    // Sort both sides to make the assertion order-independent.
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

  it("infers full capability set for text-embedding-3-small", () => {
    const caps = provider.inferCapabilities(model("text-embedding-3-small"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual(["model.count-tokens", "model.info", "model.search", "text.embedding"]);
  });
});

describe("capability-set parity", () => {
  it("OPENAI_RUN_FN_SPECS matches OPENAI_RUN_FNS serves shapes", () => {
    const fnsServes = OPENAI_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = OPENAI_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("OPENAI_RUN_FNS shape", () => {
  it("registers a runFn for every capability set the provider claims to serve", () => {
    const sets = OPENAI_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    // Spot-check that the canonical task capability sets are all present.
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("image.generation");
    expect(sets).toContain("image.editing");
    expect(sets).toContain("model.count-tokens");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });

  it("tiebreaks `text.generation` to the smallest serves entry (plain text-gen)", () => {
    const candidates = OPENAI_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    // At least one entry of size 1 should exist for plain text generation.
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });
});
