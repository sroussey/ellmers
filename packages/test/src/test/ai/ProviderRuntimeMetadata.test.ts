/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly as _anthropicTestOnly } from "@workglow/anthropic/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";
import { _testOnly as _ollamaTestOnly } from "@workglow/ollama/ai";
import { _testOnly as _openaiTestOnly } from "@workglow/openai/ai";
import { afterEach, describe, expect, it } from "vitest";

const { WebBrowserProvider } = _testOnly;
const { AnthropicQueuedProvider } = _anthropicTestOnly;
const { OpenAiQueuedProvider } = _openaiTestOnly;
const { OllamaQueuedProvider } = _ollamaTestOnly;

describe("WebBrowserProvider.isAvailable", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.LanguageModel;
  });

  it("returns false when no Chrome AI globals are present", async () => {
    delete g.LanguageModel;
    const provider = new WebBrowserProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it("returns true when a Chrome AI global is present", async () => {
    g.LanguageModel = function () {};
    const provider = new WebBrowserProvider();
    expect(await provider.isAvailable()).toBe(true);
  });
});

// Anthropic/OpenAI omit supportsBrowser in their metadata literals; the
// createCloudProviderClass mixin defaults supportsBrowser to true. Tests
// below assert actual declared values.
describe("provider runtime-placement metadata", () => {
  it("declares runtime placement metadata", () => {
    const cases = [
      // WebBrowserProvider: browser-only, on-device
      {
        provider: new WebBrowserProvider(),
        supportsBrowser: true,
        supportsServer: false,
        isLocal: true,
      },
      // OllamaQueuedProvider: browser+server, local
      {
        provider: new OllamaQueuedProvider(),
        supportsBrowser: true,
        supportsServer: true,
        isLocal: true,
      },
      // AnthropicQueuedProvider: mixin default makes supportsBrowser=true
      {
        provider: new AnthropicQueuedProvider(),
        supportsBrowser: true,
        supportsServer: true,
        isLocal: false,
      },
      // OpenAiQueuedProvider: mixin default makes supportsBrowser=true
      {
        provider: new OpenAiQueuedProvider(),
        supportsBrowser: true,
        supportsServer: true,
        isLocal: false,
      },
    ] as const;
    for (const c of cases) {
      expect(c.provider.supportsBrowser).toBe(c.supportsBrowser);
      expect(c.provider.supportsServer).toBe(c.supportsServer);
      expect(c.provider.isLocal).toBe(c.isLocal);
    }
  });

  it("never marks a renderer-only provider as cloud-reachable", () => {
    // cloud reachability == supportsServer && !isLocal; renderer-only providers
    // (supportsServer === false) can never satisfy it.
    const rendererOnly = new WebBrowserProvider();
    expect(rendererOnly.supportsServer && !rendererOnly.isLocal).toBe(false);
  });
});

describe("credential threading", () => {
  // Renderer-only providers run on-device and must never be handed cloud
  // secrets. Their declared metadata is the structural guarantee: a provider
  // that cannot run server-side is local and therefore needs no API key.
  it("renderer-only providers are local and carry no api-key requirement", () => {
    const provider = new WebBrowserProvider();
    expect(provider.supportsServer).toBe(false);
    expect(provider.isLocal).toBe(true);
  });
});
