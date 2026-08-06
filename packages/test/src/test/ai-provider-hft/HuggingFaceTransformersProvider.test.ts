/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import {
  mapHfProviderConfig,
  pipelineToTaskTypes,
  taskTypeToPipelines,
} from "@workglow/ai/provider-utils";
import { _testOnly } from "@workglow/huggingface-transformers/ai";
import { describe, expect, it } from "vitest";

const { HuggingFaceTransformersQueuedProvider, HFT_RUN_FN_SPECS, HFT_RUN_FNS } = _testOnly;

function model(
  model_id: string,
  opts: { capabilities?: readonly string[]; pipeline_task?: string } = {}
): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "HF_TRANSFORMERS_ONNX",
    provider_config: {
      model_path: model_id,
      ...(opts.pipeline_task ? { pipeline_task: opts.pipeline_task } : {}),
    },
    capabilities: [...(opts.capabilities ?? [])],
    metadata: {},
  } as ModelRecord;
}

describe("HuggingFaceTransformersQueuedProvider.inferCapabilities", () => {
  const provider = new HuggingFaceTransformersQueuedProvider(HFT_RUN_FNS);

  it("trusts declared capabilities when present", () => {
    const caps = provider.inferCapabilities(
      model("Xenova/anything", { capabilities: ["text.embedding"] })
    );
    expect(caps).toEqual(["text.embedding"]);
  });

  it("maps pipeline_task=text-generation to full text-gen capabilities", () => {
    const caps = provider.inferCapabilities(
      model("onnx-community/Llama-3.2-1B-Instruct", { pipeline_task: "text-generation" })
    );
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("cache.checkpoint");
    expect(caps).toContain("model.count-tokens");
    expect(caps).toContain("model.download-remove");
  });

  it("maps pipeline_task=feature-extraction to text.embedding", () => {
    const caps = provider.inferCapabilities(
      model("Xenova/all-MiniLM-L6-v2", { pipeline_task: "feature-extraction" })
    );
    expect(caps).toContain("text.embedding");
    expect(caps).not.toContain("text.generation");
  });

  it("maps pipeline_task=image-classification to image.classification", () => {
    const caps = provider.inferCapabilities(
      model("Xenova/vit-base-patch16-224", { pipeline_task: "image-classification" })
    );
    expect(caps).toContain("image.classification");
  });

  it("maps pipeline_task=object-detection to image.object-detection", () => {
    const caps = provider.inferCapabilities(
      model("Xenova/yolos-tiny", { pipeline_task: "object-detection" })
    );
    expect(caps).toContain("image.object-detection");
  });

  it("falls back to name-pattern matching when pipeline_task is absent (llama → text-gen)", () => {
    const caps = provider.inferCapabilities(model("onnx-community/Llama-3.2-1B-Instruct-q4f16"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("cache.checkpoint");
  });

  it("does not infer cache.checkpoint for non-generative pipelines", () => {
    const caps = provider.inferCapabilities(
      model("Xenova/all-MiniLM-L6-v2", { pipeline_task: "feature-extraction" })
    );
    expect(caps).not.toContain("cache.checkpoint");
  });

  it("falls back to name-pattern matching for embedding models (MiniLM)", () => {
    const caps = provider.inferCapabilities(model("Xenova/all-MiniLM-L6-v2"));
    expect(caps).toContain("text.embedding");
  });

  it("falls back to name-pattern matching for CLIP models", () => {
    const caps = provider.inferCapabilities(model("Xenova/clip-vit-base-patch32"));
    expect(caps).toContain("image.classification");
    expect(caps).toContain("image.embedding");
  });

  it("returns baseline meta-ops for truly unknown models", () => {
    const caps = provider.inferCapabilities(model("totally-unknown-no-hints"));
    expect(caps).toEqual(["model.search", "model.info"]);
  });
});

describe("HFT HuggingFace pipeline mappings", () => {
  it("treats sentence-similarity as text embedding but stores feature-extraction for Transformers.js", () => {
    expect(taskTypeToPipelines("TextEmbeddingTask")).toContain("sentence-similarity");
    expect(pipelineToTaskTypes("sentence-similarity")).toEqual(["TextEmbeddingTask"]);
    expect(
      mapHfProviderConfig(
        {
          id: "sentence-transformers/all-MiniLM-L6-v2",
          modelId: "sentence-transformers/all-MiniLM-L6-v2",
          pipeline_tag: "sentence-similarity",
          likes: 0,
          downloads: 1,
        },
        "HF_TRANSFORMERS_ONNX"
      )
    ).toEqual({
      model_path: "sentence-transformers/all-MiniLM-L6-v2",
      pipeline: "feature-extraction",
    });
  });
});

describe("capability-set parity", () => {
  it("HFT_RUN_FN_SPECS matches HFT_RUN_FNS serves shapes", () => {
    const fnsServes = HFT_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = HFT_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("HFT_RUN_FNS shape", () => {
  it("registers a runFn for every canonical capability set", () => {
    const sets = HFT_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.translation");
    expect(sets).toContain("text.question-answering");
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("text.classification");
    expect(sets).toContain("text.language-detection");
    expect(sets).toContain("text.fill-mask");
    expect(sets).toContain("text.ner");
    expect(sets).toContain("image.classification");
    expect(sets).toContain("image.embedding");
    expect(sets).toContain("image.segmentation");
    expect(sets).toContain("image.to-text");
    expect(sets).toContain("image.background-removal");
    expect(sets).toContain("image.object-detection");
    expect(sets).toContain("model.count-tokens");
    expect(sets).toContain("model.download-remove");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
    expect(sets).toContain("cache.checkpoint");
    expect(sets).toContain("session.dispose");
  });

  it("tiebreaks `text.generation` to the smallest serves entry", () => {
    const candidates = HFT_RUN_FNS.filter((r) => r.serves.includes("text.generation"));
    expect(candidates.some((r) => r.serves.length === 1)).toBe(true);
  });
});
