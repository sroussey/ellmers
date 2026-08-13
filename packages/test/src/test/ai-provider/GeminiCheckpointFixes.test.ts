/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiSessionContext,
  CacheCheckpointTaskInput,
  ChatMessage,
  TextGenerationTaskInput,
  ToolCallingTaskInput,
  ToolDefinition,
} from "@workglow/ai";
import { promptToTailMessages } from "@workglow/ai/worker";
import { GOOGLE_GEMINI, _testOnly } from "@workglow/google-gemini/ai";
import * as GeminiRuntime from "@workglow/google-gemini/ai-runtime";
import {
  buildGeminiPrefixedContents,
  canonicalGeminiToolsKey,
  geminiCachedToolsMatch,
  geminiCachedToolsMatchCanonical,
  _testOnly as runtimeTestOnly,
} from "@workglow/google-gemini/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Route store reads/writes through the ai bundle's `_testOnly` helpers so the
// state the run-fns (also imported off the ai bundle) look at is exactly what
// the tests seed and inspect. (The runtime-bundle copies are used only by the
// direct helper unit tests below, which stay within that bundle's own map.)
const setGeminiCachedContent = _testOnly.setGeminiCachedContent;
const getGeminiCachedContent = _testOnly.getGeminiCachedContent;
const _cacheStoreTestOnly = _testOnly.cacheStoreTestOnly;

const geminiRequests: Array<Record<string, unknown>> = [];

// Fake Gemini client injected through the runtime's own test seam (module-level
// SDK mocks are unreliable here — see OpenAIGeminiCheckpointParams.test.ts).
// Injected into both bundles because the dist build splits `ai.js` and
// `ai-runtime.js` into separate bundles with independent module state.
const fakeGeminiClient = {
  models: {
    generateContentStream: async (request: Record<string, unknown>) => {
      geminiRequests.push(request);
      return {
        async *[Symbol.asyncIterator]() {},
      };
    },
  },
  caches: {
    create: async () => ({}),
    delete: async () => {},
  },
} as never;

beforeEach(() => {
  geminiRequests.length = 0;
  _testOnly.setGeminiClientForTests(fakeGeminiClient);
  runtimeTestOnly.setGeminiClientForTests(fakeGeminiClient);
  _cacheStoreTestOnly.clearForTests();
});

afterEach(() => {
  _testOnly.setGeminiClientForTests(undefined);
  runtimeTestOnly.setGeminiClientForTests(undefined);
  _cacheStoreTestOnly.clearForTests();
});

/**
 * Overrides only the client methods a test cares about, keeping the shared
 * request-log seam intact so every override still exercises the run-fn wiring.
 */
function installGeminiClient(overrides: {
  cachesCreate?: (...args: unknown[]) => Promise<Record<string, unknown>>;
  cachesDelete?: (arg: { name: string }) => Promise<void>;
  generateContentStream?: (
    request: Record<string, unknown>
  ) => Promise<AsyncIterable<Record<string, unknown>>>;
}): { deletedNames: string[] } {
  const deletedNames: string[] = [];
  const client = {
    models: {
      generateContentStream:
        overrides.generateContentStream ??
        (async (request: Record<string, unknown>) => {
          geminiRequests.push(request);
          return { async *[Symbol.asyncIterator]() {} };
        }),
    },
    caches: {
      create: async (...args: unknown[]) => {
        if (overrides.cachesCreate) {
          return await overrides.cachesCreate(...args);
        }
        return {};
      },
      delete: async (arg: { name: string }) => {
        deletedNames.push(arg.name);
        if (overrides.cachesDelete) await overrides.cachesDelete(arg);
      },
    },
  } as never;
  _testOnly.setGeminiClientForTests(client);
  runtimeTestOnly.setGeminiClientForTests(client);
  return { deletedNames };
}

/** Registration lookup — the `serves` list of the run-fn we want to drive. */
function findGeminiRunFn(capability: string): AiProviderRunFn {
  const registration = _testOnly.GEMINI_RUN_FNS.find(({ serves }) =>
    (serves as readonly string[]).includes(capability)
  );
  expect(registration).toBeDefined();
  return registration!.runFn as AiProviderRunFn;
}

const testModel = {
  provider: GOOGLE_GEMINI,
  provider_config: { api_key: "test-key", model_name: "gemini-test" },
} as never;

const weatherTool: ToolDefinition = {
  name: "weather",
  description: "Get weather",
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string", description: "City" },
      units: { type: "string", enum: ["c", "f"] },
    },
    required: ["location"],
  },
};

/** Same wire declaration as {@link weatherTool}, with permuted key order. */
const weatherToolPermuted: ToolDefinition = {
  name: "weather",
  description: "Get weather",
  inputSchema: {
    required: ["location"],
    properties: {
      units: { enum: ["c", "f"], type: "string" },
      location: { description: "City", type: "string" },
    },
    type: "object",
  },
};

const timeTool: ToolDefinition = {
  name: "time",
  description: "Get time",
  inputSchema: {
    type: "object",
    properties: { timezone: { type: "string" } },
  },
};

function requestTexts(request: Record<string, unknown>): Array<string | undefined> {
  const contents = request.contents as Array<{ parts: Array<{ text?: string }> }>;
  return contents.map((c) => c.parts[0]?.text);
}

describe("Gemini cache warm-up degrades on the real too-small message", () => {
  const warmupPrefix = {
    systemPrompt: "sys",
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
  };
  const realTooSmallMessage =
    "Cached content is too small. total_token_count=7, min_total_token_count=4096";
  const jsonWrappedMessage = JSON.stringify({
    error: { code: 400, message: realTooSmallMessage, status: "INVALID_ARGUMENT" },
  });

  it.each([
    ["bare API message", "too-small-bare", realTooSmallMessage],
    ["JSON-wrapped ApiError message", "too-small-json", jsonWrappedMessage],
  ])(
    "degrades to no entry instead of throwing on the %s",
    async (_label, checkpointId, message) => {
      installGeminiClient({
        cachesCreate: async () => {
          // The installed @google/genai ApiError carries the HTTP status as a
          // number and (for JSON bodies) the JSON.stringify'd error body as its
          // message.
          throw Object.assign(new Error(message), { status: 400 });
        },
      });
      const runFn = findGeminiRunFn("cache.checkpoint");
      const events: Array<Record<string, unknown>> = [];
      await runFn(
        { model: "gemini-test" } as CacheCheckpointTaskInput,
        testModel,
        new AbortController().signal,
        (event) => events.push(event as Record<string, unknown>),
        undefined,
        { sessionId: checkpointId, prefix: warmupPrefix }
      );
      expect(events).toEqual([{ type: "finish", data: { checkpoint: checkpointId } }]);
      expect(getGeminiCachedContent(checkpointId)).toBeUndefined();
    }
  );

  it("still rethrows an unrelated 400", async () => {
    installGeminiClient({
      cachesCreate: async () => {
        throw Object.assign(new Error("Invalid value at 'contents[0].parts'"), { status: 400 });
      },
    });
    const runFn = findGeminiRunFn("cache.checkpoint");
    await expect(
      runFn(
        { model: "gemini-test" } as CacheCheckpointTaskInput,
        testModel,
        new AbortController().signal,
        () => {},
        undefined,
        { sessionId: "unrelated-400", prefix: warmupPrefix }
      )
    ).rejects.toThrow(/Invalid value/);
    expect(getGeminiCachedContent("unrelated-400")).toBeUndefined();
  });
});

describe("Gemini cache.checkpoint warm-up reports write usage", () => {
  const warmupPrefix = {
    systemPrompt: "sys",
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
  };

  it("emits cacheWrite from the CachedContent usageMetadata and records it on the entry", async () => {
    installGeminiClient({
      cachesCreate: async () => ({
        name: "cachedContents/usage-warm",
        usageMetadata: { totalTokenCount: 12345 },
      }),
    });
    const runFn = findGeminiRunFn("cache.checkpoint");
    const events: Array<Record<string, unknown>> = [];
    await runFn(
      { model: "gemini-test" } as CacheCheckpointTaskInput,
      testModel,
      new AbortController().signal,
      (event) => events.push(event as Record<string, unknown>),
      undefined,
      { sessionId: "usage-warm", prefix: warmupPrefix }
    );
    expect(events).toEqual([
      {
        type: "finish",
        data: { checkpoint: "usage-warm" },
        usage: {
          input: undefined,
          output: undefined,
          cached: undefined,
          cacheWrite: 12345,
          reasoning: undefined,
          total: undefined,
          extra: undefined,
        },
      },
    ]);
    expect(getGeminiCachedContent("usage-warm")?.tokens).toBe(12345);
  });

  it("reports no usage — and stores no token count — when the create response carries none", async () => {
    installGeminiClient({
      cachesCreate: async () => ({ name: "cachedContents/no-usage" }),
    });
    const runFn = findGeminiRunFn("cache.checkpoint");
    const events: Array<Record<string, unknown>> = [];
    await runFn(
      { model: "gemini-test" } as CacheCheckpointTaskInput,
      testModel,
      new AbortController().signal,
      (event) => events.push(event as Record<string, unknown>),
      undefined,
      { sessionId: "no-usage", prefix: warmupPrefix }
    );
    expect(events).toEqual([{ type: "finish", data: { checkpoint: "no-usage" } }]);
    expect(events[0]).not.toHaveProperty("usage");
    expect(getGeminiCachedContent("no-usage")?.tokens).toBeUndefined();
  });

  it("reports no usage when the warm-up degrades to inline replay", async () => {
    installGeminiClient({
      cachesCreate: async () => {
        throw Object.assign(
          new Error("Cached content is too small. total_token_count=7, min_total_token_count=4096"),
          { status: 400 }
        );
      },
    });
    const runFn = findGeminiRunFn("cache.checkpoint");
    const events: Array<Record<string, unknown>> = [];
    await runFn(
      { model: "gemini-test" } as CacheCheckpointTaskInput,
      testModel,
      new AbortController().signal,
      (event) => events.push(event as Record<string, unknown>),
      undefined,
      { sessionId: "usage-degrade", prefix: warmupPrefix }
    );
    // A degraded warm-up creates no entry, so there is nothing to bill —
    // asserting no `usage` key (not merely an undefined-valued one) is what
    // catches a fabricated cacheWrite on this path.
    expect(events).toEqual([{ type: "finish", data: { checkpoint: "usage-degrade" } }]);
    expect(events[0]).not.toHaveProperty("usage");
    expect(getGeminiCachedContent("usage-degrade")).toBeUndefined();
  });
});

describe("Gemini text.generation refuses a tools-warmed CachedContent", () => {
  it("falls back to inline replay when the prefix carries tools", async () => {
    const checkpointId = "tools-warmed-text";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/tools-warmed",
      model: testModel,
      systemPrompt: "sys",
    });
    const runFn = findGeminiRunFn("text.generation");
    const session: AiSessionContext = {
      sessionId: checkpointId,
      prefix: {
        systemPrompt: "sys",
        tools: [weatherTool],
        messages: [{ role: "user", content: [{ type: "text", text: "prefix" }] }],
      },
    };
    await runFn(
      { model: "gemini-test", prompt: "tail" } as TextGenerationTaskInput,
      testModel,
      new AbortController().signal,
      () => {},
      undefined,
      session
    );
    expect(geminiRequests).toHaveLength(1);
    const config = geminiRequests[0].config as Record<string, unknown>;
    // Inline replay: no cache handle, prefix system prompt inline, and no
    // tools param (the text-only run-fn never sends declarations).
    expect(config.cachedContent).toBeUndefined();
    expect(config.systemInstruction).toBe("sys");
    expect(config.tools).toBeUndefined();
    expect(requestTexts(geminiRequests[0])).toEqual(["prefix", "tail"]);
    // The entry itself stays — tool-calling consumers can still reference it.
    expect(getGeminiCachedContent(checkpointId)?.name).toBe("cachedContents/tools-warmed");
  });
});

describe("Gemini checkpoint-seeded chat consumers (ownedSession + seedCheckpointId)", () => {
  const chatMessages: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "turn one" }] },
    { role: "assistant", content: [{ type: "text", text: "reply one" }] },
    { role: "user", content: [{ type: "text", text: "turn two" }] },
  ];
  const chatPrefix = {
    systemPrompt: "sys",
    messages: [
      { role: "user" as const, content: [{ type: "text" as const, text: "prefix message" }] },
    ],
  };

  function chatSession(checkpointId: string): AiSessionContext {
    return {
      sessionId: "chat-session-uuid",
      seedCheckpointId: checkpointId,
      ownedSession: true,
      prefix: chatPrefix,
    };
  }

  it("resolves the CachedContent through seedCheckpointId and sends tail-only contents", async () => {
    const checkpointId = "chat-seed";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/chat-seed",
      model: testModel,
      systemPrompt: "sys",
    });
    const runFn = findGeminiRunFn("text.generation");
    const input: TextGenerationTaskInput & { messages: ReadonlyArray<ChatMessage> } = {
      model: "gemini-test",
      prompt: "ignored",
      messages: chatMessages,
    };
    await runFn(
      input,
      testModel,
      new AbortController().signal,
      () => {},
      undefined,
      chatSession(checkpointId)
    );
    expect(geminiRequests).toHaveLength(1);
    const request = geminiRequests[0] as {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
      config: Record<string, unknown>;
    };
    expect(request.config.cachedContent).toBe("cachedContents/chat-seed");
    expect(request.config.systemInstruction).toBeUndefined();
    // contents carry ONLY the conversation — the prefix lives in the cache.
    expect(request.contents.map(({ role }) => role)).toEqual(["user", "model", "user"]);
    expect(requestTexts(geminiRequests[0])).toEqual(["turn one", "reply one", "turn two"]);
  });

  it("replays inline when the chat composes its own system prompt", async () => {
    const checkpointId = "chat-seed-own-sys";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/chat-own-sys",
      model: testModel,
      systemPrompt: "sys",
    });
    const runFn = findGeminiRunFn("text.generation");
    const input: TextGenerationTaskInput & {
      messages: ReadonlyArray<ChatMessage>;
      systemPrompt: string;
    } = {
      model: "gemini-test",
      prompt: "ignored",
      messages: chatMessages,
      systemPrompt: "chat own sys",
    };
    await runFn(
      input,
      testModel,
      new AbortController().signal,
      () => {},
      undefined,
      chatSession(checkpointId)
    );
    expect(geminiRequests).toHaveLength(1);
    const config = geminiRequests[0].config as Record<string, unknown>;
    expect(config.cachedContent).toBeUndefined();
    expect(config.systemInstruction).toBe("chat own sys");
    // Inline replay prepends the prefix messages ahead of the conversation.
    expect(requestTexts(geminiRequests[0])).toEqual([
      "prefix message",
      "turn one",
      "reply one",
      "turn two",
    ]);
    // Ineligibility must never dispose the seed checkpoint's entry.
    expect(getGeminiCachedContent(checkpointId)?.name).toBe("cachedContents/chat-own-sys");
  });

  it("evicts the seed entry and retries inline when the server-side cache is gone", async () => {
    const checkpointId = "chat-seed-not-found";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/chat-gone",
      model: testModel,
      systemPrompt: "sys",
    });
    const requests: Array<Record<string, unknown>> = [];
    let call = 0;
    const helper = installGeminiClient({
      generateContentStream: async (request) => {
        requests.push(request);
        call += 1;
        if (call === 1) {
          throw Object.assign(new Error("cachedContents/chat-gone NOT_FOUND"), {
            status: 404,
            code: "NOT_FOUND",
          });
        }
        return { async *[Symbol.asyncIterator]() {} };
      },
    });
    const runFn = findGeminiRunFn("text.generation");
    const input: TextGenerationTaskInput & { messages: ReadonlyArray<ChatMessage> } = {
      model: "gemini-test",
      prompt: "ignored",
      messages: chatMessages,
    };
    await runFn(
      input,
      testModel,
      new AbortController().signal,
      () => {},
      undefined,
      chatSession(checkpointId)
    );
    expect(requests).toHaveLength(2);
    expect((requests[0].config as Record<string, unknown>).cachedContent).toBe(
      "cachedContents/chat-gone"
    );
    expect((requests[1].config as Record<string, unknown>).cachedContent).toBeUndefined();
    // The dead entry is evicted under the SEED id — the server side is already
    // gone, so releasing the local handle is correct even for a chat consumer.
    expect(getGeminiCachedContent(checkpointId)).toBeUndefined();
    expect(helper.deletedNames).toEqual(["cachedContents/chat-gone"]);
  });
});

describe("Gemini shared proactive stale eviction helper", () => {
  it("returns false and keeps a fresh entry", () => {
    const id = "evict-helper-fresh";
    GeminiRuntime.setGeminiCachedContent(id, {
      name: "cachedContents/fresh",
      model: testModel,
      systemPrompt: undefined,
    });
    const entry = GeminiRuntime.getGeminiCachedContent(id)!;
    expect(GeminiRuntime.evictIfStaleGeminiCachedContent(id, entry)).toBe(false);
    expect(GeminiRuntime.getGeminiCachedContent(id)).toBeDefined();
    GeminiRuntime.deleteGeminiCachedContentLocal(id);
  });

  it("evicts a stale entry and returns true", () => {
    const id = "evict-helper-stale";
    GeminiRuntime.setGeminiCachedContent(id, {
      name: "cachedContents/stale",
      model: testModel,
      systemPrompt: undefined,
      createdAtMs: Date.now() - 3_600_000,
    });
    const entry = GeminiRuntime.getGeminiCachedContent(id)!;
    expect(GeminiRuntime.evictIfStaleGeminiCachedContent(id, entry)).toBe(true);
    expect(GeminiRuntime.getGeminiCachedContent(id)).toBeUndefined();
  });
});

describe("Gemini tool-calling canonical prefix tools + staleness ordering", () => {
  const toolPrefix = {
    systemPrompt: "sys",
    tools: [weatherTool],
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "prefix" }] }],
  };

  async function runToolCalling(
    checkpointId: string,
    tools: ToolDefinition[],
    prefix: AiSessionContext["prefix"] = toolPrefix
  ): Promise<void> {
    const runFn = findGeminiRunFn("tool-use");
    const input: ToolCallingTaskInput = {
      model: "gemini-test",
      prompt: "tail",
      tools,
      toolChoice: "auto",
    };
    await runFn(input, testModel, new AbortController().signal, () => {}, undefined, {
      sessionId: checkpointId,
      prefix,
    });
  }

  it("warm-up stores the canonical prefix tools and a permuted consumer hits the cache", async () => {
    const checkpointId = "canonical-warm";
    installGeminiClient({
      cachesCreate: async () => ({ name: "cachedContents/canonical-warm" }),
    });
    const warmRunFn = findGeminiRunFn("cache.checkpoint");
    await warmRunFn(
      { model: "gemini-test" } as CacheCheckpointTaskInput,
      testModel,
      new AbortController().signal,
      () => {},
      undefined,
      { sessionId: checkpointId, prefix: toolPrefix }
    );
    const entry = getGeminiCachedContent(checkpointId);
    expect(entry?.name).toBe("cachedContents/canonical-warm");
    expect(entry?.canonicalTools).toBe(canonicalGeminiToolsKey([weatherTool]));

    // A consumer with permuted-but-equivalent declarations matches against the
    // STORED canonical string and references the cache handle.
    await runToolCalling(checkpointId, [weatherToolPermuted]);
    expect(geminiRequests).toHaveLength(1);
    const config = geminiRequests[0].config as Record<string, unknown>;
    expect(config.cachedContent).toBe("cachedContents/canonical-warm");
    expect(config.tools).toBeUndefined();
  });

  it("falls back to inline replay when input tools mismatch the stored canonical form", async () => {
    const checkpointId = "canonical-mismatch";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/canonical-mismatch",
      model: testModel,
      systemPrompt: "sys",
      canonicalTools: canonicalGeminiToolsKey([weatherTool]),
    });
    await runToolCalling(checkpointId, [timeTool]);
    expect(geminiRequests).toHaveLength(1);
    const config = geminiRequests[0].config as Record<string, unknown>;
    expect(config.cachedContent).toBeUndefined();
    expect(config.tools).toBeDefined();
    // A merely-mismatched (non-stale) entry stays for consumers that DO match.
    expect(getGeminiCachedContent(checkpointId)).toBeDefined();
  });

  it("matches by direct comparison for an entry stored without canonicalTools", async () => {
    const checkpointId = "canonical-absent";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/canonical-absent",
      model: testModel,
      systemPrompt: "sys",
    });
    await runToolCalling(checkpointId, [weatherTool]);
    expect(geminiRequests).toHaveLength(1);
    const config = geminiRequests[0].config as Record<string, unknown>;
    expect(config.cachedContent).toBe("cachedContents/canonical-absent");
  });

  it("evicts a stale entry even when the tools comparison would have failed", async () => {
    const checkpointId = "stale-before-match";
    setGeminiCachedContent(checkpointId, {
      name: "cachedContents/stale-before-match",
      model: testModel,
      systemPrompt: "sys",
      canonicalTools: canonicalGeminiToolsKey([weatherTool]),
      createdAtMs: Date.now() - 3_600_000,
    });
    // Input tools MISMATCH the stored canonical form. Staleness now runs
    // FIRST, so the doomed entry is evicted without paying for (or being
    // shielded by) the tools comparison.
    await runToolCalling(checkpointId, [timeTool]);
    expect(geminiRequests).toHaveLength(1);
    expect((geminiRequests[0].config as Record<string, unknown>).cachedContent).toBeUndefined();
    expect(getGeminiCachedContent(checkpointId)).toBeUndefined();
  });

  it("geminiCachedToolsMatchCanonical agrees with geminiCachedToolsMatch", () => {
    expect(geminiCachedToolsMatch([weatherTool], [weatherToolPermuted])).toBe(true);
    expect(geminiCachedToolsMatch([weatherTool], [timeTool])).toBe(false);
    expect(
      geminiCachedToolsMatchCanonical(canonicalGeminiToolsKey([weatherTool]), [weatherToolPermuted])
    ).toBe(true);
    expect(
      geminiCachedToolsMatchCanonical(canonicalGeminiToolsKey([weatherTool]), [timeTool])
    ).toBe(false);
  });
});

describe("Gemini buildGeminiPrefixedContents uses the shared prompt-tail helper", () => {
  const prefix = {
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "prefix" }] }],
  };

  it("lifts a string prompt into a single user tail turn", () => {
    const contents = buildGeminiPrefixedContents(prefix, undefined, "tail");
    expect(contents).toHaveLength(2);
    expect(contents[1]).toEqual({ role: "user", parts: [{ text: "tail" }] });
    expect(promptToTailMessages("tail")).toEqual([
      { role: "user", content: [{ type: "text", text: "tail" }] },
    ]);
  });

  it("appends no tail turn for an absent or empty prompt", () => {
    expect(buildGeminiPrefixedContents(prefix, undefined, "")).toHaveLength(1);
    expect(buildGeminiPrefixedContents(prefix, undefined, undefined)).toHaveLength(1);
    expect(promptToTailMessages("")).toEqual([]);
  });

  it("maps a block-array prompt into one user turn of blocks", () => {
    const contents = buildGeminiPrefixedContents(prefix, undefined, ["a", "b"]);
    expect(contents).toHaveLength(2);
    expect(contents[1]).toEqual({ role: "user", parts: [{ text: "a" }, { text: "b" }] });
  });
});
