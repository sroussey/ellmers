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

const model = {
  model_id: "hfi-x",
  provider_config: {
    model_name: "meta-llama/Meta-Llama-3-8B-Instruct",
    api_key: "test-key",
  },
} as any;

/**
 * HF Inference routes to third-party providers, so a billed-usage chunk is
 * volunteered rather than requested — there is no `include_usage` opt-in. It
 * arrives last and carries an EMPTY `choices` array, which is why the run-fns
 * read `chunk.usage` outside the delta guard: a usage-only chunk contributes no
 * text and would otherwise be skipped entirely.
 */
const usageChunk = {
  choices: [],
  usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 },
};

const cases = [
  {
    label: "HFI_TextGeneration_Stream",
    serves: "text.generation",
    input: { prompt: "hi" },
    text: "hello",
  },
  {
    label: "HFI_TextRewriter_Stream",
    serves: "text.rewriter",
    input: { prompt: "rewrite", text: "input" },
    text: "rewritten",
  },
  {
    label: "HFI_TextSummary_Stream",
    serves: "text.summary",
    input: { text: "input" },
    text: "summary",
  },
] as const;

/**
 * These three run-fns hand-roll their stream loop rather than going through
 * `accumulateOpenAIChatStream` (which only the tool-calling run-fn uses), and
 * every sibling OpenAI-shaped provider — DeepSeek, OpenRouter, xAI — forwards
 * the provider's stated total on `finish.usage` from that same loop. HFI's text
 * run-fns were the only ones dropping it, so a billed figure the upstream had
 * already sent was discarded and the character-count estimate was all that
 * remained.
 */
describe("HFI text run-fns forward provider-stated usage", () => {
  beforeEach(() => {
    chunkQueue = [];
    _setHfInferenceSDKForTesting({ InferenceClient: FakeInferenceClient } as any);
  });

  afterEach(() => {
    _setHfInferenceSDKForTesting(undefined);
  });

  for (const { label, serves, input, text } of cases) {
    describe(label, () => {
      it("reports the stated total on finish when the upstream volunteers one", async () => {
        chunkQueue = [{ choices: [{ delta: { content: text } }] }, usageChunk];

        const events: any[] = [];
        await findRunFn(serves)(input as any, model, new AbortController().signal, (e) =>
          events.push(e)
        );

        const finish = events.at(-1);
        expect(finish?.type).toBe("finish");
        expect(finish?.usage).toMatchObject({ input: 31, output: 7, total: 38 });
      });

      // Support varies by the provider the request is routed to. With no usage
      // chunk the field stays absent rather than becoming a zeroed total, which
      // would read downstream as "billed nothing" instead of "never reported".
      it("leaves usage undefined when the upstream reports none", async () => {
        chunkQueue = [{ choices: [{ delta: { content: text } }] }];

        const events: any[] = [];
        await findRunFn(serves)(input as any, model, new AbortController().signal, (e) =>
          events.push(e)
        );

        const finish = events.at(-1);
        expect(finish?.type).toBe("finish");
        expect(finish?.usage).toBeUndefined();
      });

      // The estimate exists to move the CLI counter during the call and is
      // emitted as `usage` events either way; forwarding the stated total must
      // not silence it.
      it("still emits provisional usage events during the stream", async () => {
        chunkQueue = [{ choices: [{ delta: { content: text } }] }, usageChunk];

        const events: any[] = [];
        await findRunFn(serves)(input as any, model, new AbortController().signal, (e) =>
          events.push(e)
        );

        expect(events.some((e) => e.type === "usage")).toBe(true);
      });

      /**
       * Where the two halves meet. Mid-stream snapshots are character-count
       * guesses and carry `estimated`, which keeps them out of the retired
       * total and out of every cost figure derived from it. The provider's own
       * total carries no such marker, so forwarding it is what puts a real
       * figure back into accounting — without it this run would show a live
       * counter and then record nothing at all.
       */
      it("marks the provisional snapshots estimated but not the stated total", async () => {
        chunkQueue = [{ choices: [{ delta: { content: text } }] }, usageChunk];

        const events: any[] = [];
        await findRunFn(serves)(input as any, model, new AbortController().signal, (e) =>
          events.push(e)
        );

        const provisional = events.filter((e) => e.type === "usage");
        expect(provisional.length).toBeGreaterThan(0);
        for (const event of provisional) {
          expect(event.usage?.estimated).toBe(true);
        }
        expect(events.at(-1)?.usage?.estimated).toBeUndefined();
      });
    });
  }
});
