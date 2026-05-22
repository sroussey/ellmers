/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebBrowserModelConfig } from "@workglow/chrome-ai/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const { WebBrowser_Chat, resetWebBrowserSessionsForTests } = _testOnly;

const model = {
  model_id: "gemini-nano",
  title: "Gemini Nano",
  description: "",
  provider: "WEB_BROWSER",
  provider_config: { model_name: "gemini-nano" },
  capabilities: ["text.generation"],
  metadata: {},
} as unknown as WebBrowserModelConfig;

type GlobalWithLanguageModel = typeof globalThis & { LanguageModel?: typeof LanguageModel };

function streamFromSnapshots(values: readonly string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
}

describe("WebBrowser_Chat", () => {
  const globalWithLanguageModel = globalThis as GlobalWithLanguageModel;
  const originalLanguageModel = globalWithLanguageModel.LanguageModel;

  afterEach(() => {
    if (originalLanguageModel === undefined) {
      delete globalWithLanguageModel.LanguageModel;
    } else {
      globalWithLanguageModel.LanguageModel = originalLanguageModel;
    }
    resetWebBrowserSessionsForTests();
    vi.restoreAllMocks();
  });

  it("reuses the same LanguageModel session across calls with the same sessionId", async () => {
    const promptStreaming = vi.fn((prompt: string) => streamFromSnapshots([`reply:${prompt}`]));
    const destroy = vi.fn();
    const create = vi.fn(async () => ({ promptStreaming, destroy }));
    globalWithLanguageModel.LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    } as unknown as typeof LanguageModel;

    const events: Array<{ type: string; textDelta?: string }> = [];
    const input = {
      model,
      prompt: "ignored",
      systemPrompt: "Use the docs.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };

    await WebBrowser_Chat(
      input as any,
      model,
      new AbortController().signal,
      (event) => {
        events.push(event as { type: string; textDelta?: string });
      },
      undefined,
      "session-1"
    );
    await WebBrowser_Chat(
      {
        ...input,
        messages: [{ role: "user", content: [{ type: "text", text: "Follow up" }] }],
      } as any,
      model,
      new AbortController().signal,
      () => {},
      undefined,
      "session-1"
    );

    expect(create).toHaveBeenCalledOnce();
    expect(promptStreaming).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "finish")).toBe(true);
  });

  it("retries once with a fresh session when Chrome reports a destroyed session", async () => {
    const staleDestroy = vi.fn();
    const freshDestroy = vi.fn();
    const stalePrompt = vi.fn(() => {
      throw new DOMException(
        "The model execution session has been destroyed.",
        "InvalidStateError"
      );
    });
    const freshPrompt = vi.fn(() => streamFromSnapshots(["ok"]));
    const create = vi
      .fn()
      .mockResolvedValueOnce({ promptStreaming: stalePrompt, destroy: staleDestroy })
      .mockResolvedValueOnce({ promptStreaming: freshPrompt, destroy: freshDestroy });
    globalWithLanguageModel.LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    } as unknown as typeof LanguageModel;

    const deltas: string[] = [];
    await WebBrowser_Chat(
      {
        model,
        prompt: "ignored",
        systemPrompt: "Use the docs.",
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      } as any,
      model,
      new AbortController().signal,
      (event) => {
        if (event.type === "text-delta") deltas.push((event as { textDelta: string }).textDelta);
      },
      undefined,
      "session-1"
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(staleDestroy).toHaveBeenCalledOnce();
    expect(freshPrompt).toHaveBeenCalledOnce();
    expect(deltas.join("")).toBe("ok");
  });

  it("emits every append chunk as text-delta when Chrome streams incremental chunks", async () => {
    const promptStreaming = vi.fn(() => streamFromSnapshots(["The", " answer", " continues."]));
    const create = vi.fn(async () => ({ promptStreaming, destroy: vi.fn() }));
    globalWithLanguageModel.LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    } as unknown as typeof LanguageModel;

    const deltas: string[] = [];
    await WebBrowser_Chat(
      {
        model,
        prompt: "ignored",
        systemPrompt: "Use the docs.",
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      } as any,
      model,
      new AbortController().signal,
      (event) => {
        if (event.type === "text-delta") deltas.push((event as { textDelta: string }).textDelta);
      },
      undefined,
      "session-1"
    );

    expect(deltas.join("")).toBe("The answer continues.");
  });
});
