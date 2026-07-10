/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDefinition } from "@workglow/ai";
import {
  accumulateOpenAIResponsesStream,
  buildResponsesInput,
  buildResponsesTools,
  mapResponsesToolChoice,
  parseResponsesToolCalls,
} from "@workglow/ai/provider-utils";
import { describe, expect, it } from "vitest";

/** Turn a fixed array of Responses events into the async iterable the accumulator consumes. */
async function* events(list: readonly unknown[]): AsyncIterable<unknown> {
  for (const e of list) yield e;
}

/** Collect the accumulator's emitted stream events. */
async function collect(list: readonly unknown[]): Promise<any[]> {
  const out: any[] = [];
  await accumulateOpenAIResponsesStream(events(list), (e) => out.push(e));
  return out;
}

describe("accumulateOpenAIResponsesStream", () => {
  it("maps output_text deltas to text-delta events on the text port", async () => {
    const out = await collect([
      { type: "response.created" },
      { type: "response.output_text.delta", delta: "Hel", item_id: "msg_1", output_index: 0 },
      { type: "response.output_text.delta", delta: "lo", item_id: "msg_1", output_index: 0 },
      { type: "response.output_text.delta", delta: "", item_id: "msg_1", output_index: 0 },
      { type: "response.completed" },
    ]);
    expect(out).toEqual([
      { type: "text-delta", port: "text", textDelta: "Hel" },
      { type: "text-delta", port: "text", textDelta: "lo" },
    ]);
  });

  it("accumulates a single tool call's fragmented argument JSON", async () => {
    const out = await collect([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_abc",
          name: "get_weather",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: "fc_1",
        delta: '{"city":',
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: "fc_1",
        delta: '"Paris"}',
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_abc",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        },
      },
      { type: "response.completed" },
    ]);

    // Every emit targets the toolCalls port and carries the stable call_id.
    expect(out.every((e) => e.type === "object-delta" && e.port === "toolCalls")).toBe(true);
    expect(out.every((e) => e.objectDelta[0].id === "call_abc")).toBe(true);
    expect(out.every((e) => e.objectDelta[0].name === "get_weather")).toBe(true);

    // Final emit (from output_item.done) has the fully-parsed input.
    expect(out.at(-1)?.objectDelta[0].input).toEqual({ city: "Paris" });
  });

  it("keeps concurrent tool calls separate by output_index", async () => {
    const out = await collect([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", call_id: "call_a", name: "alpha", arguments: "" },
      },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "function_call", call_id: "call_b", name: "beta", arguments: "" },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "fc_b",
        delta: '{"b":2}',
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: "fc_a",
        delta: '{"a":1}',
      },
      { type: "response.completed" },
    ]);

    const a = out.find((e) => e.objectDelta[0].id === "call_a");
    const b = out.find((e) => e.objectDelta[0].id === "call_b");
    expect(a.objectDelta[0]).toMatchObject({ name: "alpha", input: { a: 1 } });
    expect(b.objectDelta[0]).toMatchObject({ name: "beta", input: { b: 2 } });
  });

  it("interleaves text and tool-call deltas without cross-contamination", async () => {
    const out = await collect([
      { type: "response.output_text.delta", delta: "thinking...", output_index: 0, item_id: "msg" },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "function_call", call_id: "call_x", name: "fn", arguments: "" },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "fc_x",
        delta: "{}",
      },
      { type: "response.completed" },
    ]);
    expect(out[0]).toEqual({ type: "text-delta", port: "text", textDelta: "thinking..." });
    expect(out[1]).toMatchObject({ type: "object-delta", port: "toolCalls" });
  });

  it("synthesizes an id when a delta precedes output_item.added", async () => {
    const out = await collect([
      {
        type: "response.function_call_arguments.delta",
        output_index: 2,
        item_id: "fc_orphan",
        delta: "{}",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].objectDelta[0].id).toBe("fc_orphan");
  });

  it("surfaces refusal deltas as first-class refusal events", async () => {
    const out = await collect([
      { type: "response.created" },
      { type: "response.refusal.delta", delta: "I can't ", item_id: "msg", output_index: 0 },
      { type: "response.refusal.delta", delta: "help with that.", item_id: "msg", output_index: 0 },
      { type: "response.completed" },
    ]);
    expect(out).toEqual([
      { type: "refusal", refusal: "I can't " },
      { type: "refusal", refusal: "help with that." },
    ]);
  });

  it("ignores reasoning-summary and lifecycle events", async () => {
    const out = await collect([
      { type: "response.created" },
      { type: "response.reasoning_summary_text.delta", delta: "hmm" },
      { type: "response.in_progress" },
      { type: "response.output_text.delta", delta: "hi", output_index: 0, item_id: "m" },
      { type: "response.completed" },
    ]);
    expect(out).toEqual([{ type: "text-delta", port: "text", textDelta: "hi" }]);
  });
});

const TOOL: ToolDefinition = {
  name: "get_weather",
  description: "Get weather for a city",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
} as unknown as ToolDefinition;

describe("buildResponsesTools", () => {
  it("emits the flat Responses function-tool shape", () => {
    const [tool] = buildResponsesTools([TOOL]);
    expect(tool.type).toBe("function");
    expect(tool.name).toBe("get_weather");
    expect(typeof tool.description).toBe("string");
    expect(tool.parameters).toEqual(TOOL.inputSchema);
    expect(tool.strict).toBe(false);
    // No nested `function` wrapper (that's the chat shape).
    expect((tool as any).function).toBeUndefined();
  });
});

describe("mapResponsesToolChoice", () => {
  it("passes keywords through and wraps a named function", () => {
    expect(mapResponsesToolChoice(undefined)).toBe("auto");
    expect(mapResponsesToolChoice("auto")).toBe("auto");
    expect(mapResponsesToolChoice("none")).toBe("none");
    expect(mapResponsesToolChoice("required")).toBe("required");
    expect(mapResponsesToolChoice("get_weather")).toEqual({
      type: "function",
      name: "get_weather",
    });
  });
});

describe("buildResponsesInput", () => {
  it("uses the prompt string as input when there are no messages", () => {
    expect(buildResponsesInput({ prompt: "hello" })).toEqual({
      input: "hello",
      instructions: undefined,
    });
  });

  it("lifts systemPrompt into instructions", () => {
    expect(buildResponsesInput({ prompt: "hi", systemPrompt: "be terse" })).toEqual({
      input: "hi",
      instructions: "be terse",
    });
  });

  it("lifts system/developer messages into instructions and keeps the rest as input items", () => {
    const result = buildResponsesInput({
      messages: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    expect(result.instructions).toBe("you are helpful");
    expect(result.input).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("translates a tool-result message into a function_call_output item", () => {
    const result = buildResponsesInput({
      messages: [{ role: "tool", content: "72F and sunny", tool_call_id: "call_abc" }],
    });
    expect(result.input).toEqual([
      { type: "function_call_output", call_id: "call_abc", output: "72F and sunny" },
    ]);
  });

  it("translates an assistant tool_calls message into function_call items", () => {
    const result = buildResponsesInput({
      messages: [
        {
          role: "assistant",
          content: "let me check",
          tool_calls: [
            { id: "call_abc", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
          ],
        },
      ],
    });
    expect(result.input).toEqual([
      { role: "assistant", content: "let me check" },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "get_weather",
        arguments: '{"city":"NYC"}',
      },
    ]);
  });

  it("maps user image_url parts to Responses input_image parts", () => {
    const result = buildResponsesInput({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
    });
    expect(result.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "what is this?" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
  });

  it("coerces an unknown role to a user message", () => {
    const result = buildResponsesInput({ messages: [{ role: "weird", content: "hi" }] });
    expect(result.input).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("parseResponsesToolCalls", () => {
  it("extracts function_call items and ignores messages/reasoning", () => {
    const calls = parseResponsesToolCalls([
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content: [] },
      {
        type: "function_call",
        call_id: "call_1",
        name: "get_weather",
        arguments: '{"city":"NYC"}',
      },
    ]);
    expect(calls).toEqual([{ id: "call_1", name: "get_weather", input: { city: "NYC" } }]);
  });

  it("falls back to a synthesized id and empty args", () => {
    const calls = parseResponsesToolCalls([{ type: "function_call", name: "fn", arguments: "" }]);
    expect(calls).toEqual([{ id: "call_0", name: "fn", input: {} }]);
  });
});
