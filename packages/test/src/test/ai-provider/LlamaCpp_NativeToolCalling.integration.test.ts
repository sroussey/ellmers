/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal node-llama-cpp native function calling test.
 * Uses the SDK directly (no workglow abstractions) to show which models
 * return `functionCalls` from `LlamaChat.generateResponse` and which
 * silently embed tool calls in the response text instead.
 */

import { loadSdk } from "@workglow/node-llama-cpp/ai-runtime";
import { afterAll, describe, it } from "vitest";

type LlamaCppSDK = Awaited<ReturnType<typeof loadSdk>>;
type LlamaInstance = Awaited<ReturnType<LlamaCppSDK["getLlama"]>>;

const models = [
  { label: "LFM2 1.2B Tool", url: "hf:LiquidAI/LFM2-1.2B-Tool-GGUF:Q8_0" },
  { label: "Qwen2.5 Coder 1.5B", url: "hf:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M" },
  { label: "Llama 3.2 1B", url: "hf:unsloth/Llama-3.2-1B-Instruct-GGUF:Q4_K_M" },
];

const functions = {
  get_weather: {
    description: "Get the current weather for a city.",
    params: {
      type: "object" as const,
      properties: {
        location: { type: "string" as const },
      },
      required: ["location"],
    },
  },
};

describe("node-llama-cpp native function calling", () => {
  const timeout = 10 * 60 * 1000;
  let llama: LlamaInstance | undefined;

  afterAll(async () => {
    await llama?.dispose();
  });

  for (const { label, url } of models) {
    it(
      label,
      async () => {
        const { getLlama, LlamaChat, resolveModelFile } = await loadSdk();
        llama ??= await getLlama();
        const modelPath = await resolveModelFile(url, "./models");
        const model = await llama.loadModel({ modelPath });
        const context = await model.createContext({ flashAttention: true });
        const sequence = context.getSequence();
        const chat = new LlamaChat({ contextSequence: sequence });

        const res = await chat.generateResponse(
          [{ type: "user", text: "What is the weather in San Francisco?" }],
          { functions, maxTokens: 200, seed: 42 }
        );

        const hasFnCalls = (res.functionCalls?.length ?? 0) > 0;

        console.log(`\n--- ${label} (wrapper: ${chat.chatWrapper.wrapperName}) ---`);
        console.log(`functionCalls: ${hasFnCalls ? JSON.stringify(res.functionCalls) : "NONE"}`);
        console.log(`response text: ${JSON.stringify(res.response.slice(0, 200))}`);
        if (!hasFnCalls && res.response) {
          console.log(`⚠ tool call embedded in text, not returned via functionCalls`);
        }

        chat.dispose({ disposeSequence: false });
        sequence.dispose();
        await context.dispose();
        await model.dispose();
        // expect(hasFnCalls).toBe(true);
      },
      timeout
    );
  }
});
