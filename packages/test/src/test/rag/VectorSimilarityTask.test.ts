/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { similarity, SimilarityFn, VectorSimilarityTask } from "@workglow/ai";
import { setLogger } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

type MemSnapshot = ReturnType<typeof process.memoryUsage>;
const mb = (n: number) => (n / 1024 / 1024).toFixed(0) + "MB";
const signedMb = (n: number) => (n >= 0 ? "+" : "") + (n / 1024 / 1024).toFixed(0) + "MB";
const snapMem = (): MemSnapshot => process.memoryUsage();
const reportMem = (label: string, start?: MemSnapshot) => {
  const m = process.memoryUsage();
  const fmt = (cur: number, base: number | undefined) =>
    base === undefined ? mb(cur) : `${mb(cur)} (${signedMb(cur - base)})`;
  process.stderr.write(
    `[${label}] MEM rss=${fmt(m.rss, start?.rss)} heap=${fmt(m.heapUsed, start?.heapUsed)} ext=${fmt(m.external, start?.external)} ab=${fmt(m.arrayBuffers, start?.arrayBuffers)}\n`
  );
};
const reportTime = (label: string, started: number) => {
  process.stderr.write(`[${label}] TIME ${((Date.now() - started) / 1000).toFixed(2)}s\n`);
};

let _started = 0;
let _startMem: MemSnapshot;
beforeEach(() => {
  _started = Date.now();
  _startMem = snapMem();
});
afterEach((ctx) => {
  reportTime(`vec-sim: ${ctx.task.name}`, _started);
  reportMem(`vec-sim: ${ctx.task.name}`, _startMem);
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
