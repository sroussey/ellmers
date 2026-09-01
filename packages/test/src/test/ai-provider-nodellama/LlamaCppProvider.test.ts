/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { _testOnly } from "@workglow/node-llama-cpp/ai";
import { describe, expect, it } from "vitest";

const { LlamaCppQueuedProvider, LLAMACPP_RUN_FN_SPECS, LLAMACPP_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "LOCAL_LLAMACPP",
    provider_config: { model_path: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("LlamaCppQueuedProvider.inferCapabilities", () => {
  const provider = new LlamaCppQueuedProvider(LLAMACPP_RUN_FNS);

  it("trusts declared capabilities", () => {
    const caps = provider.inferCapabilities(model("anything.gguf", ["text.classification"]));
    expect(caps).toEqual(["text.classification"]);
  });

  it("infers text.embedding for embedding GGUF names", () => {
    const caps = provider.inferCapabilities(model("nomic-embed-text-v1.5.Q4_K_M.gguf"));
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
    // Both act on a chat session an embedding GGUF has no wrapper to build:
    // advertised, either one clears model selection and throws inside the
    // provider instead of being rejected with a capability message.
    expect(caps).not.toContain("cache.checkpoint");
    expect(caps).not.toContain("session.dispose");
  });

  it("defaults to full generative for any other GGUF", () => {
    const caps = provider.inferCapabilities(model("Mistral-7B-Instruct-v0.3.Q4_K_M.gguf"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("model.count-tokens");
    expect(caps).toContain("model.download-remove");
  });

  it("returns baseline meta-ops for empty id", () => {
    const caps = provider.inferCapabilities(model(""));
    expect(caps).toEqual(["model.search", "model.info"]);
  });
});

describe("capability-set parity", () => {
  it("LLAMACPP_RUN_FN_SPECS matches LLAMACPP_RUN_FNS serves shapes", () => {
    const fnsServes = LLAMACPP_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = LLAMACPP_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("LLAMACPP_RUN_FNS shape", () => {
  it("registers a runFn for every canonical capability set", () => {
    const sets = LLAMACPP_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("model.count-tokens");
    expect(sets).toContain("model.download-remove");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
    expect(sets).toContain("cache.checkpoint");
    expect(sets).toContain("session.dispose");
  });

  it("tiebreaks `text.generation` to smallest serves entry", () => {
    const candidates = LLAMACPP_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });
});
