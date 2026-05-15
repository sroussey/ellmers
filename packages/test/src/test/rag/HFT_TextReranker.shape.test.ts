/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { KbRerankerOutputError } from "@workglow/ai";
import { validateAndExtractRerankerScores } from "@workglow/huggingface-transformers/ai-runtime";
import { describe, expect, it } from "vitest";

const MODEL_PATH = "Xenova/bge-reranker-base";

/**
 * The transformers.js text-classification pipeline returns one entry per
 * input pair. With `top_k > 1` each entry is an array of `{ label, score }`
 * objects; with `top_k = 1` it is the bare object. The reranker run-fn
 * accepts both forms. These tests pin down the shape contract: anything
 * else must fail loudly so a misconfigured model produces an actionable
 * error instead of silently returning zero scores.
 */
describe("validateAndExtractRerankerScores (HFT_TextReranker shape guard)", () => {
  it("throws KbRerankerOutputError when an entry lacks a numeric `score`", () => {
    const run = () => validateAndExtractRerankerScores([{ foo: "bar" }], MODEL_PATH);
    expect(run).toThrow(KbRerankerOutputError);
    expect(run).toThrow(/unexpected pipeline output shape/);
    expect(run).toThrow(new RegExp(MODEL_PATH));
  });

  it("accepts both `{ label, score }` and `[{ label, score }]` entries and returns scores in input order", () => {
    // First entry is the bare object; second is a one-element array — the
    // shape transformers.js emits when `top_k > 1`. Both must validate and
    // produce per-document scores in the original input order.
    const scores = validateAndExtractRerankerScores(
      [{ label: "LABEL_0", score: 0.42 }, [{ label: "LABEL_0", score: 0.1 }]],
      MODEL_PATH
    );
    expect(scores).toEqual([0.42, 0.1]);
  });

  it("throws when one entry in a batch is valid and another is malformed", () => {
    // A silent `?? 0` would have hidden this and returned a 0 score for the
    // bad entry. The strict guard surfaces the misconfiguration immediately.
    const run = () =>
      validateAndExtractRerankerScores(
        [{ label: "LABEL_0", score: 0.9 }, { label: "LABEL_0" /* score missing */ }],
        MODEL_PATH
      );
    expect(run).toThrow(KbRerankerOutputError);
  });

  it("throws when the top-level value is not an array", () => {
    // Defensive: if the pipeline returns a non-array (e.g. a tensor or null)
    // we still error out rather than letting Array.prototype.map throw
    // somewhere downstream with a less actionable message.
    const run = () => validateAndExtractRerankerScores({ score: 0.5 }, MODEL_PATH);
    expect(run).toThrow(KbRerankerOutputError);
  });

  it("includes a truncated shape snippet on the error for diagnostics", () => {
    try {
      validateAndExtractRerankerScores([{ foo: "bar" }], MODEL_PATH);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(KbRerankerOutputError);
      const e = err as KbRerankerOutputError;
      expect(typeof e.actualShape).toBe("string");
      expect(e.actualShape as string).toContain("foo");
    }
  });
});
