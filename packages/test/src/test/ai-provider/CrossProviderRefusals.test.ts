/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { accumulateOpenAIChatStream } from "@workglow/ai/provider-utils";
import { _testOnly as anthropicTestOnly } from "@workglow/anthropic/ai";
import { _testOnly as geminiTestOnly } from "@workglow/google-gemini/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

const { maybeEmitAnthropicRefusal } = anthropicTestOnly;
const { geminiRefusalCategory, emitGeminiRefusal } = geminiTestOnly;

function collectSync(fn: (emit: (e: StreamEvent<any>) => void) => void): any[] {
  const out: any[] = [];
  fn((e) => out.push(e));
  return out;
}

describe("OpenAI-compatible chat refusals (xAI / HFI via accumulateOpenAIChatStream)", () => {
  async function* chatStream(deltas: Array<Record<string, unknown>>): AsyncIterable<unknown> {
    for (const delta of deltas) yield { choices: [{ delta }] };
  }

  it("maps a chat-completion delta.refusal to a first-class refusal event", async () => {
    const out: any[] = [];
    await accumulateOpenAIChatStream(
      chatStream([{ refusal: "I can't " }, { refusal: "help." }]),
      (e) => out.push(e)
    );
    expect(out).toEqual([
      { type: "refusal", refusal: "I can't " },
      { type: "refusal", refusal: "help." },
    ]);
  });

  it("keeps ordinary content on the text port (no spurious refusal)", async () => {
    const out: any[] = [];
    await accumulateOpenAIChatStream(chatStream([{ content: "hello" }]), (e) => out.push(e));
    // No promptText, so no provisional reporter is constructed and the only
    // event is the content itself — matching the Responses-shape helper, which
    // has always gated the reporter this way.
    expect(out).toEqual([{ type: "text-delta", port: "text", textDelta: "hello" }]);
  });

  it("emits provisional ↓ usage when the caller supplies promptText", async () => {
    const out: any[] = [];
    await accumulateOpenAIChatStream(
      chatStream([{ content: "hello" }]),
      (e) => out.push(e),
      undefined,
      { promptText: "hi" }
    );
    expect(out.filter((e) => e.type !== "usage")).toEqual([
      { type: "text-delta", port: "text", textDelta: "hello" },
    ]);
    // Chat-completions only bill on the final chunk, so the counter is driven
    // by a character-count estimate — flagged as such so nothing prices it.
    const estimates = out.filter((e) => e.type === "usage");
    expect(estimates.length).toBeGreaterThan(0);
    expect(estimates.some((e) => e.usage.output === 2)).toBe(true);
    expect(estimates.every((e) => e.usage.estimated === true)).toBe(true);
  });
});

describe("Anthropic refusals (maybeEmitAnthropicRefusal)", () => {
  it("emits a refusal on message_delta stop_reason=refusal", () => {
    const out = collectSync((emit) =>
      maybeEmitAnthropicRefusal({ type: "message_delta", delta: { stop_reason: "refusal" } }, emit)
    );
    expect(out).toEqual([
      {
        type: "refusal",
        refusal: "The model declined to respond to this request.",
        category: "output-refusal",
      },
    ]);
  });

  it("is a no-op for normal stop reasons and other events", () => {
    expect(
      collectSync((emit) =>
        maybeEmitAnthropicRefusal(
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
          emit
        )
      )
    ).toEqual([]);
    expect(
      collectSync((emit) =>
        maybeEmitAnthropicRefusal(
          { type: "content_block_delta", delta: { type: "text_delta" } },
          emit
        )
      )
    ).toEqual([]);
  });
});

describe("Gemini refusals (geminiRefusalCategory / emitGeminiRefusal)", () => {
  it("classifies blocked finishReasons and prompt blocks", () => {
    expect(geminiRefusalCategory({ candidates: [{ finishReason: "SAFETY" }] })).toBe("SAFETY");
    expect(geminiRefusalCategory({ candidates: [{ finishReason: "PROHIBITED_CONTENT" }] })).toBe(
      "PROHIBITED_CONTENT"
    );
    expect(geminiRefusalCategory({ promptFeedback: { blockReason: "SAFETY" } })).toBe(
      "input-blocked"
    );
  });

  it("returns undefined for normal completion", () => {
    expect(geminiRefusalCategory({ candidates: [{ finishReason: "STOP" }] })).toBeUndefined();
    expect(geminiRefusalCategory({ candidates: [{ finishReason: "MAX_TOKENS" }] })).toBeUndefined();
    expect(geminiRefusalCategory({})).toBeUndefined();
  });

  it("emits a refusal with the category, and no-ops when undefined", () => {
    expect(collectSync((emit) => emitGeminiRefusal(emit, "SAFETY"))).toEqual([
      { type: "refusal", refusal: "The response was blocked (SAFETY).", category: "SAFETY" },
    ]);
    expect(collectSync((emit) => emitGeminiRefusal(emit, "input-blocked"))).toEqual([
      {
        type: "refusal",
        refusal: "The request was blocked before generation.",
        category: "input-blocked",
      },
    ]);
    expect(collectSync((emit) => emitGeminiRefusal(emit, undefined))).toEqual([]);
  });
});
