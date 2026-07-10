/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { deriveCapabilitiesFromMeta, inferOpenRouterCapabilities } from "@workglow/openrouter/ai";
import { describe, expect, it } from "vitest";

function model(
  model_id: string,
  metadata: Record<string, unknown> = {},
  capabilities: readonly string[] = []
): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "OPENROUTER",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata,
  } as ModelRecord;
}

describe("deriveCapabilitiesFromMeta", () => {
  it("adds vision-input when image is an input modality", () => {
    const caps = deriveCapabilitiesFromMeta({
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: [],
    });
    expect(caps).toContain("vision-input");
    expect(caps).toContain("text.generation");
  });

  it("adds tool-use and json-mode from supported_parameters", () => {
    const caps = deriveCapabilitiesFromMeta({
      architecture: { input_modalities: ["text"] },
      supported_parameters: ["tools", "response_format", "structured_outputs"],
    });
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).not.toContain("vision-input");
  });

  it("returns the baseline chat set when metadata is bare", () => {
    const caps = deriveCapabilitiesFromMeta({});
    expect(caps).toContain("text.generation");
    expect(caps).toContain("text.rewriter");
    expect(caps).toContain("text.summary");
    expect(caps).toContain("model.count-tokens");
    expect(caps).toContain("model.info");
    expect(caps).toContain("model.search");
    expect(caps).not.toContain("tool-use");
  });
});

describe("inferOpenRouterCapabilities", () => {
  it("derives from record metadata when present", () => {
    const caps = inferOpenRouterCapabilities(
      model("anthropic/claude-sonnet-4", {
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["tools", "response_format"],
      })
    );
    expect(caps).toContain("text.generation");
    expect(caps).toContain("tool-use");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("vision-input");
  });

  it("falls back to declared capabilities when metadata is absent", () => {
    const caps = inferOpenRouterCapabilities(model("some/model", {}, ["text.classification"]));
    expect(caps).toEqual(["text.classification"]);
  });

  it("falls back to the baseline chat set when nothing is declared", () => {
    const caps = inferOpenRouterCapabilities(model("some/model", {}, []));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("model.search");
  });
});
