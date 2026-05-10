/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ModelRecord } from "@workglow/ai";
import { HfInferenceQueuedProvider } from "./HfInferenceQueuedProvider";
import { HFI_RUN_FNS } from "./common/HFI_JobRunFns";
import { HFI_RUN_FN_SPECS } from "./common/HFI_Capabilities";

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "HF_INFERENCE",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("HfInferenceQueuedProvider.inferCapabilities", () => {
  const provider = new HfInferenceQueuedProvider(HFI_RUN_FNS);

  it("trusts declared capabilities", () => {
    const caps = provider.inferCapabilities(
      model("anything", ["text.classification"])
    );
    expect(caps).toEqual(["text.classification"]);
  });

  it("infers text.embedding for embedding model names", () => {
    const caps = provider.inferCapabilities(model("Xenova/all-MiniLM-L6-v2"));
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
  });

  it("infers text-gen + tool-use for llama/mistral chat models", () => {
    const caps = provider.inferCapabilities(model("mistralai/Mistral-7B-Instruct-v0.3"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
  });

  it("infers image.generation + image.editing for FLUX/SD models", () => {
    const flux = provider.inferCapabilities(model("black-forest-labs/FLUX.1-dev"));
    expect(flux).toContain("image.generation");
    expect(flux).toContain("image.editing");

    const sdxl = provider.inferCapabilities(model("stabilityai/stable-diffusion-xl-base-1.0"));
    expect(sdxl).toContain("image.generation");
  });

  it("returns baseline meta-ops for unknown ids", () => {
    const caps = provider.inferCapabilities(model("totally-unknown-no-hints"));
    expect(caps).toEqual(["provider.model-search", "provider.model-info"]);
  });

  it("infers exact capability set for mistral", () => {
    const caps = provider.inferCapabilities(model("mistralai/Mistral-7B-Instruct"));
    const sorted = [...caps].sort();
    expect(sorted).toEqual([
      "provider.model-info",
      "provider.model-search",
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
    ]);
  });
});

describe("capability-set parity", () => {
  it("HFI_RUN_FN_SPECS matches HFI_RUN_FNS serves shapes", () => {
    const fnsServes = HFI_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = HFI_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("HFI_RUN_FNS shape", () => {
  it("registers a runFn for every canonical capability set", () => {
    const sets = HFI_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("image.generation");
    expect(sets).toContain("image.editing");
    expect(sets).toContain("provider.model-search");
    expect(sets).toContain("provider.model-info");
  });

  it("tiebreaks `text.generation` to the smallest serves entry", () => {
    const candidates = HFI_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });
});
