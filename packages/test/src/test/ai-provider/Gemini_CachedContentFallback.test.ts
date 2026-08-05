/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiModelConfig } from "@workglow/google-gemini/ai";
import { _testOnly } from "@workglow/google-gemini/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  isGeminiCachedContentNotFoundError,
  generateGeminiStreamWithCacheFallback,
  setGeminiCachedContent,
  getGeminiCachedContent,
  cacheStoreTestOnly,
  setGeminiClientForTests,
} = _testOnly;

const testModel = {
  name: "gemini-test",
  provider_config: { model_name: "gemini-2.5-flash", api_key: "test-key" },
} as unknown as GeminiModelConfig;

// Offline stand-in so the eviction path's best-effort server delete never
// loads the SDK or reaches the network.
const fakeGeminiClient = {
  caches: {
    delete: async () => {},
  },
} as never;

/** Seeds a store entry so eviction (or its absence) is observable. */
function seedCacheEntry(id: string): void {
  setGeminiCachedContent(id, {
    name: `cachedContents/${id}`,
    model: testModel,
    systemPrompt: undefined,
  });
}

beforeEach(() => {
  setGeminiClientForTests(fakeGeminiClient);
  cacheStoreTestOnly.clearForTests();
});

afterEach(() => {
  setGeminiClientForTests(undefined);
  cacheStoreTestOnly.clearForTests();
});

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
  it("retries once WITHOUT the handle and evicts only after the retry succeeds", async () => {
    seedCacheEntry("chk-A");
    const runStream = vi
      .fn<(request: Record<string, unknown>) => Promise<string>>()
      .mockImplementationOnce(async () => {
        // The entry must still be present when the retry is issued: eviction
        // is the consequence of the retry, never a precondition for it.
        expect(getGeminiCachedContent("chk-A")).toBeDefined();
        throw { status: 404, message: "cachedContents/chk-A not found" };
      })
      .mockImplementationOnce(async () => {
        expect(getGeminiCachedContent("chk-A")).toBeDefined();
        return "retry-ok";
      });
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
    // The retry proved the handle was the problem, so the entry is gone.
    expect(getGeminiCachedContent("chk-A")).toBeUndefined();
  });

  it("keeps the entry and propagates the retry error when the cache-free retry ALSO fails", async () => {
    seedCacheEntry("chk-B");
    const runStream = vi
      .fn<(request: Record<string, unknown>) => Promise<string>>()
      .mockImplementationOnce(async () => {
        throw { status: 404, message: "cachedContents/chk-B not found" };
      })
      .mockImplementationOnce(async () => {
        throw { status: 500, message: "backend unavailable" };
      });
    const buildRequest = vi
      .fn<(useCachedContent: boolean) => Record<string, unknown>>()
      .mockImplementation((useCache) => ({ useCache }));

    // The retry error propagates, not the original NOT_FOUND: the cache-free
    // request is the terminal, cache-independent failure.
    await expect(
      generateGeminiStreamWithCacheFallback({
        useCachedContent: true,
        checkpointId: "chk-B",
        buildRequest,
        runStream,
      })
    ).rejects.toMatchObject({ status: 500, message: "backend unavailable" });

    expect(buildRequest).toHaveBeenCalledTimes(2);
    expect(buildRequest).toHaveBeenNthCalledWith(2, false);
    expect(runStream).toHaveBeenCalledTimes(2);
    // The handle was not what broke the call, so the shared entry survives for
    // its other consumers instead of forcing them into a full re-encode.
    expect(getGeminiCachedContent("chk-B")).toBeDefined();
  });

  it("does NOT retry or evict on a non-CachedContent NOT_FOUND (model-not-found)", async () => {
    seedCacheEntry("chk-C");
    const runStream = vi.fn(async () => {
      throw { status: 400, message: "The requested model 'gemini-x-nope' was not found." };
    });
    const buildRequest = vi.fn((useCache: boolean) => ({ useCache }));

    await expect(
      generateGeminiStreamWithCacheFallback({
        useCachedContent: true,
        checkpointId: "chk-C",
        buildRequest,
        runStream,
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(buildRequest).toHaveBeenCalledTimes(1);
    expect(runStream).toHaveBeenCalledTimes(1);
    expect(getGeminiCachedContent("chk-C")).toBeDefined();
  });

  it("does NOT retry or evict when useCachedContent is false, even on a cache-scoped NOT_FOUND", async () => {
    seedCacheEntry("chk-D");
    const runStream = vi.fn(async () => {
      throw { status: 404, message: "cachedContents/chk-D not found" };
    });
    const buildRequest = vi.fn((useCache: boolean) => ({ useCache }));

    await expect(
      generateGeminiStreamWithCacheFallback({
        useCachedContent: false,
        checkpointId: "chk-D",
        buildRequest,
        runStream,
      })
    ).rejects.toMatchObject({ status: 404 });

    expect(buildRequest).toHaveBeenCalledTimes(1);
    expect(runStream).toHaveBeenCalledTimes(1);
    expect(getGeminiCachedContent("chk-D")).toBeDefined();
  });

  it("does NOT retry or evict when no checkpointId is supplied", async () => {
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
