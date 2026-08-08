/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { similarity, SimilarityFn, VectorSimilarityTask } from "@workglow/ai";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { report, snap } from "../../binding/testTiming";

let _snap = snap();
beforeEach(() => {
  _snap = snap();
});
afterEach(() => {
  report("vec-sim", _snap);
});

describe("VectorSimilarityTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  const query = new Float32Array([1, 0, 0]);
  const vectors = [
    new Float32Array([1, 0, 0]),
    new Float32Array([0, 1, 0]),
    new Float32Array([0.7, 0.7, 0]),
  ];

  test("similarity() routes through run() and returns ranked results", async () => {
    const result = await similarity({
      query,
      vectors,
      method: SimilarityFn.COSINE,
      topK: 3,
    });

    expect(result).toBeDefined();
    expect(result.output).toHaveLength(3);
    expect(result.score).toHaveLength(3);
    expect(result.score[0]).toBeGreaterThanOrEqual(result.score[1]);
    expect(result.score[1]).toBeGreaterThanOrEqual(result.score[2]);
  });

  test("run() and runPreview() return identical results", async () => {
    const input = { query, vectors, method: SimilarityFn.COSINE, topK: 2 };
    const runResult = await new VectorSimilarityTask().run(input);
    const previewResult = await new VectorSimilarityTask().runPreview(input);

    expect(runResult.score).toEqual(previewResult.score);
    expect(runResult.output).toEqual(previewResult.output);
  });

  test("topK limits the number of results", async () => {
    const result = await similarity({ query, vectors, method: SimilarityFn.COSINE, topK: 1 });
    expect(result.output).toHaveLength(1);
    expect(result.score).toHaveLength(1);
  });
});
