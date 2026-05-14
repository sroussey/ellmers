/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { KbRerankerOutputError } from "@workglow/ai";
import { describe, expect, it, vi } from "vitest";

// `HFT_TextReranker` is not re-exported from a public barrel — it is wired up
// via `HFT_TASKS` in `HFT_JobRunFns.ts`. We import it via the deep module path
// so the test exercises the actual run-fn rather than a registry indirection.
// Mock `getPipeline` from the same deep path; vi.mock is hoisted, so the
// import below resolves to the mocked version.
vi.mock("@workglow/huggingface-transformers/dist/ai/common/HFT_Pipeline", () => ({
  getPipeline: vi.fn(),
}));
vi.mock("../../../../../providers/huggingface-transformers/src/ai/common/HFT_Pipeline", () => ({
  getPipeline: vi.fn(),
}));

import { HFT_TextReranker } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_TextReranker";
import { getPipeline } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_Pipeline";

const getPipelineMock = getPipeline as unknown as ReturnType<typeof vi.fn>;

const MODEL_PATH = "Xenova/bge-reranker-base";

function makeModel() {
  return {
    model_id: `onnx:${MODEL_PATH}:q8`,
    provider: "HuggingFaceTransformersOnnx",
    provider_config: {
      pipeline: "text-classification" as const,
      model_path: MODEL_PATH,
    },
  } as unknown as Parameters<typeof HFT_TextReranker>[1];
}

function makeInput(documents: readonly string[]) {
  return {
    query: "q",
    documents: [...documents],
    model: `onnx:${MODEL_PATH}:q8`,
  } as Parameters<typeof HFT_TextReranker>[0];
}

const noopProgress = () => {};
const noopSignal = undefined;

describe("HFT_TextReranker pipeline output shape validation", () => {
  it("throws KbRerankerOutputError when an entry lacks a numeric `score`", async () => {
    // Single doc, single entry that's the wrong shape.
    const fakePipeline = vi.fn().mockResolvedValue([{ foo: "bar" }]);
    getPipelineMock.mockResolvedValueOnce(fakePipeline);

    const run = () =>
      HFT_TextReranker(makeInput(["doc-1"]), makeModel(), noopProgress, noopSignal);

    await expect(run()).rejects.toBeInstanceOf(KbRerankerOutputError);
    await expect(run()).rejects.toMatchObject({
      message: expect.stringContaining("unexpected pipeline output shape"),
    });
    await expect(run()).rejects.toMatchObject({
      message: expect.stringContaining(MODEL_PATH),
    });
  });

  it("accepts both `{ label, score }` and `[{ label, score }]` entries and returns per-doc scores in input order", async () => {
    // First entry is a bare object; second entry is a one-element array — the
    // shape transformers.js emits when `top_k > 1`. Both must validate.
    const fakePipeline = vi.fn().mockResolvedValue([
      { label: "LABEL_0", score: 0.42 },
      [{ label: "LABEL_0", score: 0.1 }],
    ]);
    getPipelineMock.mockResolvedValueOnce(fakePipeline);

    const result = await HFT_TextReranker(
      makeInput(["doc-A", "doc-B"]),
      makeModel(),
      noopProgress,
      noopSignal
    );

    // Scores stay in the original input order so callers can zip them back to
    // their candidate list.
    expect(result.scores).toEqual([0.42, 0.1]);
    // Indices are sorted best-first.
    expect(result.indices).toEqual([0, 1]);
  });

  it("throws when one entry in a batch is valid and another is malformed", async () => {
    // The first doc returns a well-formed score; the second returns junk.
    // A silent `?? 0` would have hidden this and returned a 0 score for doc-2.
    const fakePipeline = vi.fn().mockResolvedValue([
      { label: "LABEL_0", score: 0.9 },
      { label: "LABEL_0" /* score missing */ },
    ]);
    getPipelineMock.mockResolvedValueOnce(fakePipeline);

    await expect(
      HFT_TextReranker(
        makeInput(["doc-good", "doc-bad"]),
        makeModel(),
        noopProgress,
        noopSignal
      )
    ).rejects.toBeInstanceOf(KbRerankerOutputError);
  });
});
