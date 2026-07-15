/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  modelAbortControllers,
  pathMatchesModelSegment,
} from "@workglow/huggingface-transformers/ai-runtime";
import { afterEach, describe, expect, it } from "vitest";

describe("H2: modelAbortControllers key collision", () => {
  afterEach(() => {
    modelAbortControllers.clear();
  });

  it("two concurrent loads for the same model_path do not orphan an AbortController", () => {
    const key = "Xenova/bge-reranker-base";
    const first = new AbortController();
    const second = new AbortController();

    // Register two controllers under the same model_path — this is what
    // happens when two `getPipeline` calls with different pipeline/dtype/
    // device combinations race (the load-dedupe map keys on cacheKey, not
    // on model_path).
    let set = modelAbortControllers.get(key);
    if (!set) {
      set = new Set<AbortController>();
      modelAbortControllers.set(key, set);
    }
    set.add(first);
    set.add(second);

    expect(modelAbortControllers.get(key)?.size).toBe(2);

    // Deregister the first — the second must survive.
    const active = modelAbortControllers.get(key)!;
    active.delete(first);
    if (active.size === 0) modelAbortControllers.delete(key);
    expect(modelAbortControllers.get(key)?.size).toBe(1);
    expect(modelAbortControllers.get(key)?.has(second)).toBe(true);

    // Deregister the second — the map key is removed entirely so
    // `abortableFetch` doesn't walk a stale (but empty) key forever.
    const stillActive = modelAbortControllers.get(key)!;
    stillActive.delete(second);
    if (stillActive.size === 0) modelAbortControllers.delete(key);
    expect(modelAbortControllers.has(key)).toBe(false);
  });
});

describe("pathMatchesModelSegment", () => {
  it.each([
    // Positive: the model path appears as full path segments.
    {
      pathname: "/some/deep/Xenova/bge-reranker-base/foo",
      modelPath: "Xenova/bge-reranker-base",
      expected: true,
    },
    { pathname: "/foo/bert/config.json", modelPath: "bert", expected: true },
    // Negative: substring collisions must not match.
    {
      pathname: "/Xenova/bge-reranker-base-v2/foo",
      modelPath: "Xenova/bge-reranker-base",
      expected: false,
    },
    { pathname: "/foobert/config.json", modelPath: "bert", expected: false },
  ])("$modelPath vs $pathname -> $expected", ({ pathname, modelPath, expected }) => {
    expect(pathMatchesModelSegment(pathname, modelPath)).toBe(expected);
  });
});
