/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/chrome-ai/ai";
import { afterEach, describe, expect, it } from "vitest";

const { WebBrowserProvider } = _testOnly;

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
