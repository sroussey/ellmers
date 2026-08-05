/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/google-gemini/ai";
import { describe, expect, it, vi } from "vitest";

const { isGeminiCachedContentNotFoundError, generateGeminiStreamWithCacheFallback } = _testOnly;

describe("isGeminiCachedContentNotFoundError", () => {
  describe("true — scoped CachedContent NOT_FOUND", () => {
    it.each([
      [
        "status 404 with cachedContents/… mention",
        { status: 404, message: "CachedContent 'cachedContents/abc' not found" },
      ],
      [
        "code NOT_FOUND with cachedContent mention",
        { code: "NOT_FOUND", message: "cachedContent handle expired" },
      ],
      [
        "nested error.status NOT_FOUND with resource path",
        { error: { status: "NOT_FOUND" }, message: "cachedContents/xyz does not exist" },
      ],
      [
        "status 404 with resource wording",
        { status: 404, message: "The requested cachedContent resource was not found." },
      ],
      [
        "nested error.code 404 with cachedContents/ path",
        { error: { code: 404 }, message: "resource cachedContents/abc-123 not found" },
      ],
      [
        "status NOT_FOUND string with cachedContent",
        { status: "NOT_FOUND", message: "cachedContent NOT_FOUND" },
      ],
    ])("returns true for %s", (_label, err) => {
      expect(isGeminiCachedContentNotFoundError(err)).toBe(true);
    });
  });

  describe("false — regression cases the old matcher over-triggered on", () => {
    it.each([
      [
        "model-not-found (status 400)",
        {
          status: 400,
          message: "The requested model 'gemini-x-nope' was not found or is not available.",
        },
      ],
      ["file-not-found part", { status: 400, message: "File 'files/abc' was not found." }],
      [
        "tokenizer / function-declaration not-found",
        { message: "Function name 'foo' not found in declarations." },
      ],
      [
        "404 on unrelated URL (no cache mention)",
        {
          status: 404,
          message: "The requested URL /v1beta/models/gemini-2.5-pro:generateContent was not found.",
        },
      ],
      ["bare NOT_FOUND with no scope", new Error("NOT_FOUND")],
      ["null", null],
      ["undefined", undefined],
      ["plain string", "not found"],
      ["message-only 'not found' with no cache mention", { message: "resource not found" }],
    ])("returns false for %s", (_label, err) => {
      expect(isGeminiCachedContentNotFoundError(err)).toBe(false);
    });
  });
});

describe("generateGeminiStreamWithCacheFallback", () => {
  it("evicts + retries once on a scoped CachedContent NOT_FOUND", async () => {
    // deleteGeminiCachedContent is a no-op when the store has no entry (we
    // never seed one), so no need to mock the cache-store seam here — the
    // test's contract is on the buildRequest / runStream call pattern.
    const runStream = vi
      .fn<(request: Record<string, unknown>) => Promise<string>>()
      .mockImplementationOnce(async () => {
        throw { status: 404, message: "cachedContents/chk-A not found" };
      })
      .mockImplementationOnce(async () => "retry-ok");
    const buildRequest = vi
      .fn<(useCachedContent: boolean) => Record<string, unknown>>()
      .mockImplementation((useCache) => ({ useCache }));

    const result = await generateGeminiStreamWithCacheFallback({
      useCachedContent: true,
      checkpointId: "chk-A",
      buildRequest,
      runStream,
    });

    expect(result).toBe("retry-ok");
    expect(buildRequest).toHaveBeenCalledTimes(2);
    expect(buildRequest).toHaveBeenNthCalledWith(1, true);
    expect(buildRequest).toHaveBeenNthCalledWith(2, false);
    expect(runStream).toHaveBeenCalledTimes(2);
  });

  it("does NOT evict or retry on a non-CachedContent NOT_FOUND (model-not-found)", async () => {
    const runStream = vi.fn(async () => {
      throw { status: 400, message: "The requested model 'gemini-x-nope' was not found." };
    });
    const buildRequest = vi.fn((useCache: boolean) => ({ useCache }));

    await expect(
      generateGeminiStreamWithCacheFallback({
        useCachedContent: true,
        checkpointId: "chk-A",
        buildRequest,
        runStream,
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(buildRequest).toHaveBeenCalledTimes(1);
    expect(runStream).toHaveBeenCalledTimes(1);
  });

  it("does NOT evict or retry when useCachedContent is false, even on a cache-scoped NOT_FOUND", async () => {
    const runStream = vi.fn(async () => {
      throw { status: 404, message: "cachedContents/chk-A not found" };
    });
    const buildRequest = vi.fn((useCache: boolean) => ({ useCache }));

    await expect(
      generateGeminiStreamWithCacheFallback({
        useCachedContent: false,
        checkpointId: "chk-A",
        buildRequest,
        runStream,
      })
    ).rejects.toMatchObject({ status: 404 });

    expect(buildRequest).toHaveBeenCalledTimes(1);
    expect(runStream).toHaveBeenCalledTimes(1);
  });

  it("does NOT evict or retry when no checkpointId is supplied", async () => {
    const runStream = vi.fn(async () => {
      throw { status: 404, message: "cachedContents/mystery not found" };
    });
    const buildRequest = vi.fn((useCache: boolean) => ({ useCache }));

    await expect(
      generateGeminiStreamWithCacheFallback({
        useCachedContent: true,
        checkpointId: undefined,
        buildRequest,
        runStream,
      })
    ).rejects.toMatchObject({ status: 404 });

    expect(runStream).toHaveBeenCalledTimes(1);
  });
});
