/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiSessionContext } from "@workglow/ai";
import {
  applyAnthropicPrefixReplay,
  buildAnthropicCheckpointParams,
} from "@workglow/anthropic/ai-runtime";
import { describe, expect, it } from "vitest";

const prefix = {
  systemPrompt: "sys",
  tools: [{ name: "a", description: "A", inputSchema: { type: "object" as const } }],
  messages: [
    { role: "user" as const, content: [{ type: "text" as const, text: "hello" }] },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "hi" }] },
  ],
};

describe("buildAnthropicCheckpointParams", () => {
  it("marks system, last tool, and last prefix message with cache_control", () => {
    const params = buildAnthropicCheckpointParams(prefix, "claude-x");
    expect(params.max_tokens).toBe(1);
    expect((params.system as any[])[0].cache_control).toEqual({ type: "ephemeral" });
    const tools = params.tools as any[];
    expect(tools[tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
    const msgs = params.messages as any[];
    const lastBlocks = msgs[msgs.length - 1].content as any[];
    expect(lastBlocks[lastBlocks.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds a throwaway user message when the prefix has none", () => {
    const params = buildAnthropicCheckpointParams({ systemPrompt: "sys" }, "claude-x");
    expect((params.messages as any[]).length).toBe(1);
    expect((params.messages as any[])[0].role).toBe("user");
  });
});

describe("applyAnthropicPrefixReplay", () => {
  it("prepends prefix messages and marks the checkpoint boundary", () => {
    const session: AiSessionContext = { sessionId: "ckpt", prefix };
    const params: Record<string, unknown> = {
      messages: [{ role: "user", content: [{ type: "text", text: "tail" }] }],
    };
    applyAnthropicPrefixReplay(params, session);
    const msgs = params.messages as any[];
    expect(msgs).toHaveLength(3);
    // boundary annotation on the last block of the last PREFIX message
    const boundaryBlocks = msgs[1].content as any[];
    expect(boundaryBlocks[boundaryBlocks.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });
    // tail not annotated (no emitCheckpointId)
    const tailBlocks = msgs[2].content as any[];
    expect(tailBlocks[tailBlocks.length - 1].cache_control).toBeUndefined();
    // system from prefix applied with cache_control
    expect((params.system as any[])[0].text).toBe("sys");
  });

  it("annotates the final turn when emitting a chained checkpoint", () => {
    const session: AiSessionContext = { sessionId: "ckpt", emitCheckpointId: "next", prefix };
    const params: Record<string, unknown> = {
      messages: [{ role: "user", content: [{ type: "text", text: "tail" }] }],
    };
    applyAnthropicPrefixReplay(params, session);
    const msgs = params.messages as any[];
    const tailBlocks = msgs[msgs.length - 1].content as any[];
    expect(tailBlocks[tailBlocks.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });
});
