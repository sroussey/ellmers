/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { runFnFor } from "./WebBrowser.test-utils";

const WebBrowser_Download = runFnFor(["model.download"]);

const geminiModel = {
  model_id: "gemini-nano",
  title: "Gemini Nano",
  description: "",
  provider: "WEB_BROWSER",
  provider_config: { model_name: "gemini-nano" },
  capabilities: ["text.generation", "model.download"],
  metadata: {},
} as const;

type GlobalWithLanguageModel = typeof globalThis & { LanguageModel?: typeof LanguageModel };

describe("WebBrowser_Download", () => {
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

  it("emits phase progress from downloadprogress and finishes when create completes", async () => {
    const destroy = vi.fn();
    const create = vi
      .fn()
      .mockImplementation(async (options?: { monitor?: (m: unknown) => void }) => {
        const listeners: Array<(e: { loaded: number }) => void> = [];
        const monitor = {
          addEventListener: (_type: string, listener: (e: { loaded: number }) => void) => {
            listeners.push(listener);
          },
        };
        options?.monitor?.(monitor);
        listeners.forEach((l) => l({ loaded: 0.5 }));
        listeners.forEach((l) => l({ loaded: 1 }));
        return { destroy };
      });

    globalWithLanguageModel.LanguageModel = {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create,
    } as unknown as typeof LanguageModel;

    const phases: Array<{ message: string; progress: number | undefined }> = [];
    let finished = false;

    await WebBrowser_Download(
      { model: "gemini-nano" },
      { ...geminiModel },
      new AbortController().signal,
      (ev) => {
        if (ev.type === "phase") {
          phases.push({ message: ev.message, progress: ev.progress });
        }
        if (ev.type === "finish") finished = true;
      }
    );

    expect(create).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(phases.some((p) => p.progress === 50)).toBe(true);
    expect(phases.some((p) => p.progress === 100)).toBe(true);
    expect(finished).toBe(true);
  });

  it("skips create when the model is already available", async () => {
    const create = vi.fn();
    globalWithLanguageModel.LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    } as unknown as typeof LanguageModel;

    const phases: string[] = [];
    await WebBrowser_Download(
      { model: "gemini-nano" },
      { ...geminiModel },
      new AbortController().signal,
      (ev) => {
        if (ev.type === "phase") phases.push(ev.message);
      }
    );

    expect(create).not.toHaveBeenCalled();
    expect(phases).toContain("Already on this device");
  });
});
