/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";
import { describe, expect, it } from "vitest";

const { WebBrowserProvider, WEB_BROWSER_RUN_FN_SPECS, WEB_BROWSER_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "WEB_BROWSER",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("WebBrowserProvider.inferCapabilities", () => {
  const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);

  it("trusts declared capabilities", () => {
    const caps = provider.inferCapabilities(model("anything", ["text.translation"]));
    expect(caps).toEqual(["text.translation"]);
  });

  it("infers text-gen + rewriter + summary for chrome-prompt / gemini-nano", () => {
    expect(provider.inferCapabilities(model("chrome-prompt"))).toContain("text.generation");
    expect(provider.inferCapabilities(model("gemini-nano"))).toContain("text.generation");
  });

  it("infers text.summary for summarizer model", () => {
    const caps = provider.inferCapabilities(model("chrome-summarizer"));
    expect(caps).toContain("text.summary");
    expect(caps).not.toContain("text.generation");
  });

  it("infers text.rewriter for rewriter model", () => {
    const caps = provider.inferCapabilities(model("chrome-rewriter"));
    expect(caps).toContain("text.rewriter");
  });

  it("infers text.translation for translator model", () => {
    const caps = provider.inferCapabilities(model("chrome-translator"));
    expect(caps).toContain("text.translation");
  });

  it("infers text.language-detection for language-detector model", () => {
    const caps = provider.inferCapabilities(model("chrome-language-detector"));
    expect(caps).toContain("text.language-detection");
  });

  it("returns baseline meta-ops for unknown ids", () => {
    const caps = provider.inferCapabilities(model("unknown-id"));
    expect(caps).toEqual(["provider.model-search", "provider.model-info"]);
  });
});

describe("capability-set parity", () => {
  it("WEB_BROWSER_RUN_FN_SPECS matches WEB_BROWSER_RUN_FNS serves shapes", () => {
    const fnsServes = WEB_BROWSER_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = WEB_BROWSER_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("WEB_BROWSER_RUN_FNS shape", () => {
  it("registers a runFn for every canonical Chrome AI capability set", () => {
    const sets = WEB_BROWSER_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.translation");
    expect(sets).toContain("text.language-detection");
    expect(sets).toContain("provider.model-search");
    expect(sets).toContain("provider.model-info");
  });
});
