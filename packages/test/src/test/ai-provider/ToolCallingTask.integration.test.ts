/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseToolCallsFromText } from "@workglow/ai/provider-utils";
import { createToolCallMarkupFilter } from "@workglow/huggingface-transformers/ai-runtime";
import { describe, expect, it } from "vitest";

// ========================================================================
// Unit tests for parseToolCallsFromText (the HFT parser)
// ========================================================================

describe("parseToolCallsFromText", () => {
  it("should parse <tool_call> XML tag format", () => {
    const text = `I'll check the weather for you.\n<tool_call>{"name":"get_weather","arguments":{"location":"NYC"}}</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.text).toBe("I'll check the weather for you.");
    expect(result.toolCalls).toHaveLength(1);

    const call = result.toolCalls[0];
    expect(call.name).toBe("get_weather");
    expect(call.input).toEqual({ location: "NYC" });
  });

  it("should parse multiple <tool_call> tags", () => {
    const text = `<tool_call>{"name":"get_weather","arguments":{"location":"NYC"}}</tool_call>\n<tool_call>{"name":"get_weather","arguments":{"location":"London"}}</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].input.location).toBe("NYC");
    expect(result.toolCalls[1].input.location).toBe("London");
  });

  it("should parse bare JSON objects with name+arguments", () => {
    const text = `Here is the result: {"name":"search","arguments":{"query":"test"}}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("search");
    expect(call.input).toEqual({ query: "test" });
    expect(result.text).toBe("Here is the result:");
  });

  it("should parse bare JSON objects with name+parameters", () => {
    const text = `{"name":"search","parameters":{"query":"test"}}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("search");
    expect(call.input).toEqual({ query: "test" });
  });

  it("should parse OpenAI-style function format", () => {
    const text = `{"function":{"name":"get_weather","arguments":{"location":"Paris"}}}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("get_weather");
    expect(call.input).toEqual({ location: "Paris" });
  });

  it("should parse OpenAI-style with stringified arguments", () => {
    const text = '{"function":{"name":"get_weather","arguments":"{\\"location\\":\\"Paris\\"}"}}';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("get_weather");
    expect(call.input).toEqual({ location: "Paris" });
  });

  it("should handle nested JSON in arguments", () => {
    const text = `<tool_call>{"name":"create_event","arguments":{"title":"Meeting","details":{"time":"3pm","attendees":["Alice","Bob"]}}}</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("create_event");
    expect(call.input.title).toBe("Meeting");
    expect(call.input.details).toEqual({ time: "3pm", attendees: ["Alice", "Bob"] });
  });

  it("should return empty toolCalls for plain text", () => {
    const text = "Just a normal response with no tool calls.";
    const result = parseToolCallsFromText(text);

    expect(result.text).toBe("Just a normal response with no tool calls.");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("should handle invalid JSON inside <tool_call> tags gracefully", () => {
    const text = `<tool_call>not valid json</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(0);
  });

  it("should not match JSON objects without name key", () => {
    const text = `Here is some data: {"value": 42, "label": "test"}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toBe(`Here is some data: {"value": 42, "label": "test"}`);
  });
});

// ========================================================================
// Unit tests for createToolCallMarkupFilter (streaming markup suppression)
// ========================================================================

describe("createToolCallMarkupFilter", () => {
  function runFilter(tokens: string[]): string {
    let output = "";
    const filter = createToolCallMarkupFilter((text: string) => {
      output += text;
    });
    for (const token of tokens) {
      filter.feed(token);
    }
    filter.flush();
    return output;
  }

  it("should pass through plain text unchanged", () => {
    expect(runFilter(["Hello", " world", "!"])).toBe("Hello world!");
  });

  it("should suppress a complete <tool_call> block in a single token", () => {
    expect(
      runFilter(["Here is the result.", '<tool_call>{"name":"fn","arguments":{}}</tool_call>'])
    ).toBe("Here is the result.");
  });

  it("should suppress a <tool_call> block split across multiple tokens", () => {
    expect(
      runFilter(["Hi. ", "<tool", "_call>", '{"name":"fn",', '"arguments":{}}', "</tool", "_call>"])
    ).toBe("Hi. ");
  });

  it("should emit text after a closed tool_call block", () => {
    expect(runFilter(['<tool_call>{"name":"fn","arguments":{}}</tool_call>', " Done."])).toBe(
      " Done."
    );
  });

  it("should handle text after the close tag in the same token", () => {
    expect(runFilter(['<tool_call>{"name":"fn","arguments":{}}</tool_call> trailing text'])).toBe(
      " trailing text"
    );
  });

  it("should suppress multiple tool_call blocks", () => {
    expect(
      runFilter([
        "A",
        '<tool_call>{"name":"a","arguments":{}}</tool_call>',
        " B",
        '<tool_call>{"name":"b","arguments":{}}</tool_call>',
        " C",
      ])
    ).toBe("A B C");
  });

  it("should handle partial < prefix that is not a tool_call tag", () => {
    // A lone "<" followed by non-matching text should eventually flush
    expect(runFilter(["price ", "<", " $5"])).toBe("price < $5");
  });

  it("should handle partial <tool_ prefix that does not complete", () => {
    // If the stream ends with a partial prefix that never completed, flush it
    expect(runFilter(["text <tool_"])).toBe("text <tool_");
  });

  it("should handle the open tag split at every character boundary", () => {
    // Simulate worst-case tokenization: each character of <tool_call> is a separate token
    const tag = "<tool_call>";
    const tokens = [
      "Hi ",
      ...tag.split(""),
      '{"name":"fn","arguments":{}}',
      "</tool_call>",
      " end",
    ];
    expect(runFilter(tokens)).toBe("Hi  end");
  });

  it("should flush pending buffer when stream ends without a tag", () => {
    // Text ending with "<t" — not a full tag, should be flushed
    expect(runFilter(["hello <t"])).toBe("hello <t");
  });

  it("should not emit suppressed content even if tag is never closed", () => {
    // Unclosed tag — all content after the open tag is suppressed
    expect(runFilter(["before ", "<tool_call>", "inside tag content"])).toBe("before ");
  });
});
