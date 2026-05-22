/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelInfoTaskOutput } from "@workglow/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runFnFor } from "./WebBrowser.test-utils";

const WebBrowser_ModelInfo = runFnFor(["model.info"]);

const geminiModel = {
  model_id: "gemini-nano",
  title: "Gemini Nano",
  description: "",
  provider: "WEB_BROWSER",
  provider_config: { model_name: "gemini-nano" },
  capabilities: ["text.generation", "model.download", "model.info"],
  metadata: {},
} as const;

type GlobalWithLanguageModel = typeof globalThis & { LanguageModel?: typeof LanguageModel };

describe("WebBrowser_ModelInfo", () => {
  const globalWithLanguageModel = globalThis as GlobalWithLanguageModel;
  const originalLanguageModel = globalWithLanguageModel.LanguageModel;

  afterEach(() => {
    if (originalLanguageModel === undefined) {
      delete globalWithLanguageModel.LanguageModel;
    } else {
      globalWithLanguageModel.LanguageModel = originalLanguageModel;
    }
    vi.restoreAllMocks();
  });

  it("reports not cached when availability is downloadable", async () => {
    const availability = vi.fn().mockResolvedValue("downloadable");
    globalWithLanguageModel.LanguageModel = {
      availability,
      create: vi.fn(),
    } as unknown as typeof LanguageModel;

    let data: ModelInfoTaskOutput | undefined;
    await WebBrowser_ModelInfo(
      { model: "gemini-nano", detail: "cached_status" },
      { ...geminiModel },
      new AbortController().signal,
      (ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }
    );

    expect(data?.is_cached).toBe(false);
    expect(data?.is_loaded).toBe(false);
    expect(data?.supports_browser).toBe(true);
    expect(data?.is_downloading).toBe(false);
    expect(availability).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      })
    );
  });

  it("reports cached when availability is available", async () => {
    const availability = vi.fn().mockResolvedValue("available");
    globalWithLanguageModel.LanguageModel = {
      availability,
      create: vi.fn(),
    } as unknown as typeof LanguageModel;

    let data: ModelInfoTaskOutput | undefined;
    await WebBrowser_ModelInfo(
      { model: "gemini-nano", detail: "cached_status" },
      { ...geminiModel },
      new AbortController().signal,
      (ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }
    );

    expect(data?.is_cached).toBe(true);
    expect(data?.is_loaded).toBe(true);
    expect(data?.is_downloading).toBe(false);
  });

  it("reports downloading when Chrome is downloading the model", async () => {
    const availability = vi.fn().mockResolvedValue("downloading");
    globalWithLanguageModel.LanguageModel = {
      availability,
      create: vi.fn(),
    } as unknown as typeof LanguageModel;

    let data: ModelInfoTaskOutput | undefined;
    await WebBrowser_ModelInfo(
      { model: "gemini-nano", detail: "cached_status" },
      { ...geminiModel },
      new AbortController().signal,
      (ev) => {
        if (ev.type === "finish") data = ev.data as ModelInfoTaskOutput;
      }
    );

    expect(data?.is_cached).toBe(false);
    expect(data?.is_loaded).toBe(false);
    expect(data?.is_downloading).toBe(true);
  });
});
