/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebBrowserModelConfig } from "@workglow/chrome-ai/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceFakeTimers } from "../helpers/advanceFakeTimers";

const {
  disposeWebBrowserSession,
  disposeWebBrowserSessionsForModel,
  getWebBrowserModelKey,
  getWebBrowserSession,
  resetWebBrowserSessionsForTests,
  setWebBrowserSession,
} = _testOnly;

const model = {
  model_id: "gemini-nano",
  title: "Gemini Nano",
  description: "",
  provider: "WEB_BROWSER",
  provider_config: { model_name: "gemini-nano" },
  capabilities: ["text.generation"],
  metadata: {},
} as unknown as WebBrowserModelConfig;

describe("WebBrowser session store", () => {
  afterEach(() => {
    resetWebBrowserSessionsForTests();
    vi.useRealTimers();
  });

  it("derives model keys from provider_config.model_name before model_id", () => {
    expect(getWebBrowserModelKey(model)).toBe("gemini-nano");
    expect(
      getWebBrowserModelKey({
        ...model,
        model_id: "row-id",
        provider_config: { model_name: "chrome-gemini" },
      } as unknown as WebBrowserModelConfig)
    ).toBe("chrome-gemini");
  });

  it("stores and disposes a single session by id", async () => {
    const destroy = vi.fn();
    setWebBrowserSession("s1", {
      modelKey: "gemini-nano",
      session: { destroy } as unknown as LanguageModel,
    });

    expect(getWebBrowserSession("s1")?.modelKey).toBe("gemini-nano");
    await disposeWebBrowserSession("s1");

    expect(destroy).toHaveBeenCalledOnce();
    expect(getWebBrowserSession("s1")).toBeUndefined();
  });

  it("disposes only sessions matching the requested model key", async () => {
    const destroyA = vi.fn();
    const destroyB = vi.fn();
    setWebBrowserSession("s1", {
      modelKey: "gemini-nano",
      session: { destroy: destroyA } as unknown as LanguageModel,
    });
    setWebBrowserSession("s2", {
      modelKey: "other-model",
      session: { destroy: destroyB } as unknown as LanguageModel,
    });

    await disposeWebBrowserSessionsForModel("gemini-nano");

    expect(destroyA).toHaveBeenCalledOnce();
    expect(destroyB).not.toHaveBeenCalled();
    expect(getWebBrowserSession("s1")).toBeUndefined();
    expect(getWebBrowserSession("s2")).toBeDefined();
  });

  it("disposes an idle session after 30 minutes without model activity", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    setWebBrowserSession("s1", {
      modelKey: "gemini-nano",
      session: { destroy } as unknown as LanguageModel,
    });

    await advanceFakeTimers(30 * 60_000 - 1, { flush: false });
    expect(destroy).not.toHaveBeenCalled();

    await advanceFakeTimers(1);
    expect(destroy).toHaveBeenCalledOnce();
    expect(getWebBrowserSession("s1")).toBeUndefined();
  });
});
