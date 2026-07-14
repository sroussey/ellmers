/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/huggingface-inference/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { HFI_RUN_FNS, _setHfInferenceSDKForTesting } = _testOnly;

let chunkQueue: unknown[] = [];

async function* asyncIterOf<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

class FakeInferenceClient {
  chatCompletionStream() {
    return asyncIterOf(chunkQueue);
  }
}

function findRunFn(servesKey: string) {
  const reg = HFI_RUN_FNS.find((r) => [...r.serves].sort().join(",") === servesKey);
  if (!reg) throw new Error(`no HFI run-fn registered for ${servesKey}`);
  return reg.runFn;
}

const textGenerationFn = findRunFn("text.generation");
const textRewriterFn = findRunFn("text.rewriter");
const textSummaryFn = findRunFn("text.summary");

const model = {
  model_id: "hfi-x",
  provider_config: {
    model_name: "meta-llama/Meta-Llama-3-8B-Instruct",
    api_key: "test-key",
  },
} as any;

// The three unsafe SDK chunk shapes we replaced with `chunk.choices?.[0]?.…`:
//   - `choices` field absent (SSE keepalive / multiplexed upstream frame)
//   - `choices` is an empty array
//   - `choices[0]` exists but has no `delta` (initial role frame)
const unsafeShapes = [
  { label: "choices field absent", pre: [{}] },
  { label: "empty choices array", pre: [{ choices: [] }] },
  { label: "choices[0] with no delta", pre: [{ choices: [{}] }] },
];

describe("HFI streaming run-fns tolerate SDK chunks without choices/delta", () => {
  beforeEach(() => {
    chunkQueue = [];
    _setHfInferenceSDKForTesting({ InferenceClient: FakeInferenceClient } as any);
  });

  afterEach(() => {
    _setHfInferenceSDKForTesting(undefined);
  });

  describe("HFI_TextGeneration_Stream", () => {
    for (const { label, pre } of unsafeShapes) {
      it(`skips ${label} and emits the text-delta from later chunks`, async () => {
        chunkQueue = [...pre, { choices: [{ delta: { content: "hello" } }] }];

        const events: any[] = [];
        await expect(
          textGenerationFn({ prompt: "hi" } as any, model, new AbortController().signal, (e) =>
            events.push(e)
          )
        ).resolves.toBeUndefined();

        const textDeltas = events.filter((e) => e.type === "text-delta");
        expect(textDeltas.map((d) => d.textDelta).join("")).toBe("hello");
        expect(events.at(-1)?.type).toBe("finish");
      });
    }
  });

  describe("HFI_TextRewriter_Stream", () => {
    for (const { label, pre } of unsafeShapes) {
      it(`skips ${label} and emits the text-delta from later chunks`, async () => {
        chunkQueue = [...pre, { choices: [{ delta: { content: "rewritten" } }] }];

        const events: any[] = [];
        await expect(
          textRewriterFn(
            { prompt: "rewrite", text: "input" } as any,
            model,
            new AbortController().signal,
            (e) => events.push(e)
          )
        ).resolves.toBeUndefined();

        const textDeltas = events.filter((e) => e.type === "text-delta");
        expect(textDeltas.map((d) => d.textDelta).join("")).toBe("rewritten");
        expect(events.at(-1)?.type).toBe("finish");
      });
    }
  });

  describe("HFI_TextSummary_Stream", () => {
    for (const { label, pre } of unsafeShapes) {
      it(`skips ${label} and emits the text-delta from later chunks`, async () => {
        chunkQueue = [...pre, { choices: [{ delta: { content: "summary" } }] }];

        const events: any[] = [];
        await expect(
          textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e) =>
            events.push(e)
          )
        ).resolves.toBeUndefined();

        const textDeltas = events.filter((e) => e.type === "text-delta");
        expect(textDeltas.map((d) => d.textDelta).join("")).toBe("summary");
        expect(events.at(-1)?.type).toBe("finish");
      });
    }
  });
});
