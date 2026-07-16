/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiSessionContext } from "@workglow/ai";
import {
  buildGeminiPrefixedContents,
  deleteGeminiCachedContent,
  getGeminiCachedContent,
  setGeminiCachedContent,
} from "@workglow/google-gemini/ai-runtime";
import { mergeOpenAICheckpointPrefix } from "@workglow/openai/ai-runtime";
import { describe, expect, it } from "vitest";

const prefix = {
  systemPrompt: "sys",
  tools: [{ name: "a", description: "A", inputSchema: { type: "object" as const } }],
  messages: [
    { role: "user" as const, content: [{ type: "text" as const, text: "hello" }] },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "hi" }] },
  ],
};

describe("mergeOpenAICheckpointPrefix", () => {
  it("returns undefined without a prefix so plain calls take the unmodified path", () => {
    expect(mergeOpenAICheckpointPrefix(undefined, { prompt: "p" })).toBeUndefined();
    expect(
      mergeOpenAICheckpointPrefix({ sessionId: "s" } as AiSessionContext, { prompt: "p" })
    ).toBeUndefined();
  });

  it("prepends prefix messages ahead of a prompt-only tail", () => {
    const session: AiSessionContext = { sessionId: "ckpt", prefix };
    const merged = mergeOpenAICheckpointPrefix(session, { prompt: "tail" });
    expect(merged).toBeDefined();
    expect(merged!.messages).toHaveLength(3);
    expect(merged!.messages[0]).toEqual(prefix.messages[0]);
    expect(merged!.messages[2]).toEqual({
      role: "user",
      content: [{ type: "text", text: "tail" }],
    });
    expect(merged!.systemPrompt).toBe("sys");
  });

  it("prefers the caller's messages tail and system prompt when present", () => {
    const session: AiSessionContext = { sessionId: "ckpt", prefix };
    const tail = [{ role: "user" as const, content: [{ type: "text" as const, text: "m" }] }];
    const merged = mergeOpenAICheckpointPrefix(session, {
      messages: tail,
      systemPrompt: "own",
      prompt: "ignored",
    });
    expect(merged!.messages).toHaveLength(3);
    expect(merged!.messages[2]).toEqual(tail[0]);
    expect(merged!.systemPrompt).toBe("own");
  });
});

describe("buildGeminiPrefixedContents", () => {
  it("renders prefix messages followed by the prompt tail", () => {
    const contents = buildGeminiPrefixedContents(prefix, undefined, "tail");
    expect(contents).toHaveLength(3);
    expect(contents[0].role).toBe("user");
    expect(contents[0].parts[0].text).toBe("hello");
    expect(contents[1].role).toBe("model");
    expect(contents[2].parts[0].text).toBe("tail");
  });

  it("prefers a messages tail over the prompt", () => {
    const tail = [{ role: "user" as const, content: [{ type: "text" as const, text: "m" }] }];
    const contents = buildGeminiPrefixedContents(prefix, tail, "ignored");
    expect(contents).toHaveLength(3);
    expect(contents[2].parts[0].text).toBe("m");
  });
});

describe("Gemini cached-content store", () => {
  it("stores, retrieves, and idempotently deletes entries", async () => {
    const id = "test-ckpt-store";
    expect(getGeminiCachedContent(id)).toBeUndefined();
    setGeminiCachedContent(id, {
      name: "cachedContents/abc",
      // Deletion lazily builds a client from this config; the entry is removed
      // from the map before the API call, and API failures are swallowed, so a
      // dummy key is fine here.
      model: { provider_config: { api_key: "test", model_name: "gemini-x" } } as never,
      systemPrompt: "sys",
    });
    expect(getGeminiCachedContent(id)?.name).toBe("cachedContents/abc");
    await deleteGeminiCachedContent(id);
    expect(getGeminiCachedContent(id)).toBeUndefined();
    // second delete is a no-op
    await deleteGeminiCachedContent(id);
  });
});
