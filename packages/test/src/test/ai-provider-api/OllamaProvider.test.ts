/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { _testOnly } from "@workglow/ollama/ai";
import { describe, expect, it } from "vitest";

const { OllamaQueuedProvider, OLLAMA_RUN_FN_SPECS, OLLAMA_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "OLLAMA",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("OllamaQueuedProvider.inferCapabilities", () => {
  const provider = new OllamaQueuedProvider(OLLAMA_RUN_FNS);

  it("infers full text-gen capabilities for llama3:8b", () => {
    const caps = provider.inferCapabilities(model("llama3:8b"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("text.rewriter");
    expect(caps).toContain("text.summary");
    expect(caps).toContain("model.info");
    expect(caps).toContain("model.search");
    expect(caps).not.toContain("vision-input");
  });

  it("infers full text-gen capabilities for mistral", () => {
    const caps = provider.inferCapabilities(model("mistral"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
  });

  it("infers vision-input for llava model family", () => {
    const caps = provider.inferCapabilities(model("llava:13b"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("vision-input");
    expect(caps).toContain("tool-use");
  });

  it("infers vision-input for bakllava model family", () => {
    const caps = provider.inferCapabilities(model("bakllava"));
    expect(caps).toContain("vision-input");
  });

  it("infers text.embedding for nomic-embed-text", () => {
    const caps = provider.inferCapabilities(model("nomic-embed-text"));
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
    expect(caps).not.toContain("tool-use");
  });

  it("infers text.embedding for mxbai-embed-large:latest", () => {
    const caps = provider.inferCapabilities(model("mxbai-embed-large:latest"));
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
  });

  it("infers text.embedding for all-minilm", () => {
    const caps = provider.inferCapabilities(model("all-minilm"));
    expect(caps).toContain("text.embedding");
  });

  it("treats unknown named local models as generative by default", () => {
    // Ollama lets users pull arbitrary models — default-permissive is safer
    // than baseline-only (which would block routing of legitimate models).
    const caps = provider.inferCapabilities(model("my-custom-finetune"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
  });

  it("falls back to declared capabilities when id is empty", () => {
    const caps = provider.inferCapabilities(model("", ["text.classification"]));
    expect(caps).toEqual(["text.classification"]);
  });

  it("falls back to baseline meta-ops when nothing matches and nothing is declared", () => {
    const caps = provider.inferCapabilities(model(""));
    expect(caps).toContain("model.search");
    expect(caps).toContain("model.info");
    expect(caps).not.toContain("text.generation");
  });

  // Exact-set assertions
  it("infers exact capability set for llama3:8b", () => {
    const caps = provider.inferCapabilities(model("llama3:8b"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual([
      "json-mode",
      "model.info",
      "model.search",
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
    ]);
  });

  it("infers exact capability set for nomic-embed-text", () => {
    const caps = provider.inferCapabilities(model("nomic-embed-text"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual(["model.info", "model.search", "text.embedding"]);
  });

  it("infers exact capability set for llava:13b", () => {
    const caps = provider.inferCapabilities(model("llava:13b"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual([
      "json-mode",
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
  it("OLLAMA_RUN_FN_SPECS matches OLLAMA_RUN_FNS serves shapes", () => {
    const fnsServes = OLLAMA_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = OLLAMA_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("OLLAMA_RUN_FNS shape", () => {
  it("registers a runFn for every canonical capability set", () => {
    const sets = OLLAMA_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });

  it("tiebreaks `text.generation` to the smallest serves entry (plain text-gen)", () => {
    const candidates = OLLAMA_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });

  it("does NOT register image generation, image editing, or count-tokens", () => {
    const sets = OLLAMA_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).not.toContain("image.generation");
    expect(sets).not.toContain("image.editing");
    expect(sets).not.toContain("model.count-tokens");
  });
});
