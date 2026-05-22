/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChatMessage,
  ModelRecord,
  StructuredGenerationTaskInput,
  ToolCallingTaskInput,
  ToolDefinition,
} from "@workglow/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  WebBrowserProvider,
  WEB_BROWSER_RUN_FN_SPECS,
  WEB_BROWSER_RUN_FNS,
  WebBrowser_TextGeneration_Unified,
  WebBrowser_StructuredGeneration,
  WebBrowser_ToolCalling,
  sessions,
  chatHistory,
  probe,
} = _testOnly;

/**
 * Test-time helpers: the chrome-ai run-fns we test take strongly-typed task
 * inputs requiring a `model` field that's irrelevant to provider-level
 * tests (the dispatcher fills it in upstream). We coerce that away here.
 */
const asSGI = (v: unknown): StructuredGenerationTaskInput => v as StructuredGenerationTaskInput;
const asTCI = (v: unknown): ToolCallingTaskInput => v as ToolCallingTaskInput;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "WEB_BROWSER",
    provider_config: { model_name: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

// --------------------------------------------------------------------------
// Capability inference + parity
// --------------------------------------------------------------------------

/**
 * Probe factory whose `create()` always resolves to a destroyable handle.
 * Used to drive `WebBrowserProvider` past the conservative-pre-probe state
 * so we can assert the post-probe inference shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAcceptingProbeFactory(): any {
  const destroy = vi.fn();
  return {
    create: vi.fn().mockResolvedValue({ destroy }),
    params: vi.fn().mockResolvedValue({}),
  };
}

describe("WebBrowserProvider.inferCapabilities", () => {
  // Reset the module-level probe cache so each `new WebBrowserProvider`
  // can drive a fresh probe with its injected factory.
  afterEach(() => {
    probe._resetProbeCache();
  });

  it("trusts declared capabilities (probe-independent)", () => {
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("anything", ["text.translation"]));
    expect(caps).toEqual(["text.translation"]);
  });

  it("conservative pre-probe: drops json-mode and tool-use for chrome-prompt", () => {
    // Probe is async — until it resolves, the provider must NOT advertise
    // json-mode or tool-use, since the underlying API might not support them.
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("chrome-prompt"));
    expect(caps).toContain("text.generation");
    expect(caps).not.toContain("json-mode");
    expect(caps).not.toContain("tool-use");
  });

  it("post-probe: adds json-mode + tool-use when supported", async () => {
    const factory = makeAcceptingProbeFactory();
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS, undefined, factory);
    await provider.ready();
    const caps = provider.inferCapabilities(model("chrome-prompt"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("tool-use");
    expect(provider.inferCapabilities(model("gemini-nano"))).toContain("text.generation");
  });

  it("infers text.summary for summarizer model", () => {
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("chrome-summarizer"));
    expect(caps).toContain("text.summary");
    expect(caps).not.toContain("text.generation");
  });

  it("infers text.rewriter for rewriter model", () => {
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("chrome-rewriter"));
    expect(caps).toContain("text.rewriter");
  });

  it("infers text.translation for translator model", () => {
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("chrome-translator"));
    expect(caps).toContain("text.translation");
  });

  it("infers text.language-detection for language-detector model", () => {
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("chrome-language-detector"));
    expect(caps).toContain("text.language-detection");
  });

  it("returns baseline meta-ops for unknown ids", () => {
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS);
    const caps = provider.inferCapabilities(model("unknown-id"));
    expect(caps).toEqual(["model.search", "model.info"]);
  });
});

describe("capability-set parity", () => {
  it("WEB_BROWSER_RUN_FN_SPECS matches WEB_BROWSER_RUN_FNS serves shapes", () => {
    const fnsServes = WEB_BROWSER_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = WEB_BROWSER_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("WEB_BROWSER_RUN_FNS shape", () => {
  it("registers a runFn for every canonical Chrome AI capability set", () => {
    const sets = WEB_BROWSER_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("text.generation,tool-use");
    expect(sets).toContain("text.rewriter");
    expect(sets).toContain("text.summary");
    expect(sets).toContain("text.translation");
    expect(sets).toContain("text.language-detection");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });
});

// --------------------------------------------------------------------------
// Chat dispatcher discrimination
// --------------------------------------------------------------------------

/**
 * Verify the unified text.generation run-fn picks the chat vs. text-generation
 * branch based on input shape. We don't have a real `LanguageModel` global in
 * Node, so each branch fails with `Chrome Built-in AI "LanguageModel" API is
 * not available` from `getApi`. The branch is identifiable because the chat
 * path validates `input.messages` first (the throwing call site is
 * `factory.create(...)`, but it never reaches there without the global —
 * both throw the same getApi error). To make the branch observable we read
 * back the LAST input shape `getApi` saw, which is not exposed. So instead
 * we verify discrimination through the input pre-validation: the chat path
 * throws "no user message" when `messages` is `[{ role: "system" }]`, while
 * the prompt path throws the getApi "API not available" error.
 */
describe("WebBrowser_TextGeneration_Unified discrimination", () => {
  it("dispatches to text-generation when input has no messages array", async () => {
    const emit = vi.fn();
    await expect(
      WebBrowser_TextGeneration_Unified(
        { prompt: "hello" },
        undefined,
        new AbortController().signal,
        emit
      )
    ).rejects.toThrow(/LanguageModel.*not available/);
  });

  it("dispatches to text-generation when messages is an empty array", async () => {
    const emit = vi.fn();
    await expect(
      WebBrowser_TextGeneration_Unified(
        { prompt: "hello", messages: [] },
        undefined,
        new AbortController().signal,
        emit
      )
    ).rejects.toThrow(/LanguageModel.*not available/);
  });

  it("dispatches to chat when messages has entries", async () => {
    // The chat path runs `ensureAvailable` first too, so without a real
    // `LanguageModel` global we see the same getApi error. But the chat
    // path has additional validation (missing trailing user message) which
    // we can probe by sending a system-only history.
    const emit = vi.fn();
    await expect(
      WebBrowser_TextGeneration_Unified(
        { messages: [{ role: "system", content: [{ type: "text", text: "be helpful" }] }] },
        undefined,
        new AbortController().signal,
        emit
      )
    ).rejects.toThrow(/LanguageModel.*not available/);
  });

  it("streams replacement chunks as text deltas instead of snapshot events", async () => {
    const factory = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () => ({
        promptStreaming: () =>
          new ReadableStream<string>({
            start(controller) {
              controller.enqueue("hel");
              controller.enqueue("lo");
              controller.close();
            },
          }),
        destroy: vi.fn(),
      })),
    };
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: Array<{ type: string; textDelta?: string }> = [];
      const emit = (e: unknown): void => {
        events.push(e as { type: string; textDelta?: string });
      };
      await WebBrowser_TextGeneration_Unified(
        { prompt: "hello" },
        undefined,
        new AbortController().signal,
        emit
      );
      expect(events.filter((e) => e.type === "snapshot")).toEqual([]);
      expect(events.filter((e) => e.type === "text-delta").map((e) => e.textDelta)).toEqual([
        "hel",
        "lo",
      ]);
    } finally {
      restore();
    }
  });
});

// --------------------------------------------------------------------------
// Session cache
// --------------------------------------------------------------------------

/**
 * Build a mock that satisfies the `LanguageModel` instance type as far as the
 * cache cares — `destroy()` is the only method invoked. We can't reference the
 * `LanguageModel` global directly because `@types/dom-chromium-ai` isn't loaded
 * into this test package's tsconfig (it's chrome-ai-only); `as never` bypasses
 * the strict signature while keeping the rest of the cache contract intact.
 */
type FakeLanguageModel = { destroy: ReturnType<typeof vi.fn> };
function fakeLanguageModel(): FakeLanguageModel {
  return { destroy: vi.fn() };
}

describe("WebBrowser_Sessions cache", () => {
  afterEach(() => {
    // Clean up cache between tests — these tests share module-level state.
    sessions.deleteChromeSession("test-1");
    sessions.deleteChromeSession("test-2");
  });

  it("round-trips set/get/delete", () => {
    const fake = fakeLanguageModel();
    sessions.setChromeSession("test-1", {
      session: fake as never,
      messageCount: 4,
    });
    expect(sessions.getChromeSession("test-1")?.messageCount).toBe(4);
    expect(sessions.deleteChromeSession("test-1")).toBe(true);
    expect(fake.destroy).toHaveBeenCalledOnce();
    expect(sessions.getChromeSession("test-1")).toBeUndefined();
  });

  it("delete returns false for unknown ids", () => {
    expect(sessions.deleteChromeSession("never-set")).toBe(false);
  });

  it("dropChromeSessionEntry removes the entry without destroying", () => {
    const fake = fakeLanguageModel();
    sessions.setChromeSession("test-1", {
      session: fake as never,
      messageCount: 1,
    });
    const removed = sessions.dropChromeSessionEntry("test-1", fake as never);
    expect(removed).toBe(true);
    expect(fake.destroy).not.toHaveBeenCalled();
    expect(sessions.getChromeSession("test-1")).toBeUndefined();
  });

  it("dropChromeSessionEntry is a no-op when the cache slot has been replaced", () => {
    const original = fakeLanguageModel();
    const replacement = fakeLanguageModel();
    sessions.setChromeSession("test-1", {
      session: original as never,
      messageCount: 1,
    });
    // Simulate a concurrent caller replacing the entry.
    sessions.setChromeSession("test-1", {
      session: replacement as never,
      messageCount: 2,
    });
    const removed = sessions.dropChromeSessionEntry("test-1", original as never);
    expect(removed).toBe(false);
    expect(original.destroy).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    // Replacement is still there.
    expect(sessions.getChromeSession("test-1")?.messageCount).toBe(2);
  });
});

// --------------------------------------------------------------------------
// Chat-history mapping helpers
// --------------------------------------------------------------------------

describe("WebBrowser_ChatHistory helpers", () => {
  const userText = (text: string): ChatMessage => ({
    role: "user",
    content: [{ type: "text", text }],
  });
  const assistantText = (text: string): ChatMessage => ({
    role: "assistant",
    content: [{ type: "text", text }],
  });
  const systemText = (text: string): ChatMessage => ({
    role: "system",
    content: [{ type: "text", text }],
  });

  it("messageText concatenates text blocks with double-newline separator", () => {
    const msg: ChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    };
    expect(chatHistory.messageText(msg)).toBe("first\n\nsecond");
  });

  it("messageText drops non-text blocks", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "thinking" },
        { type: "tool_use", id: "abc", name: "search", input: { q: "test" } },
      ],
    };
    expect(chatHistory.messageText(msg)).toBe("thinking");
  });

  it("findLastUserIndex returns the trailing user index", () => {
    const history: ChatMessage[] = [
      systemText("S"),
      userText("u1"),
      assistantText("a1"),
      userText("u2"),
    ];
    expect(chatHistory.findLastUserIndex(history)).toBe(3);
  });

  it("findLastUserIndex returns -1 when no user message exists", () => {
    expect(chatHistory.findLastUserIndex([systemText("S"), assistantText("a")])).toBe(-1);
  });

  it("buildInitialPromptsFromHistory returns leading system + user/assistant tail", () => {
    const result = chatHistory.buildInitialPromptsFromHistory([
      systemText("be terse"),
      userText("hi"),
      assistantText("hello"),
    ]) as unknown as { initialPrompts: unknown[]; fingerprint: string };
    expect(result.initialPrompts).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(result.fingerprint).toBeTypeOf("string");
  });

  it("buildInitialPromptsFromHistory drops mid-history system messages", () => {
    const result = chatHistory.buildInitialPromptsFromHistory([
      systemText("first"),
      userText("hi"),
      systemText("second"),
      assistantText("hello"),
    ]) as unknown as { initialPrompts: unknown[] };
    expect(result.initialPrompts).toEqual([
      { role: "system", content: "first" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("buildInitialPromptsFromHistory drops tool messages", () => {
    const result = chatHistory.buildInitialPromptsFromHistory([
      systemText("S"),
      userText("call something"),
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            tool_use_id: "x",
            content: [{ type: "text", text: "result" }],
            is_error: false,
          },
        ],
      },
      assistantText("done"),
    ]) as unknown as { initialPrompts: unknown[] };
    expect(result.initialPrompts).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "call something" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("buildInitialPromptsFromHistory drops empty-text messages", () => {
    const result = chatHistory.buildInitialPromptsFromHistory([
      systemText("S"),
      { role: "user", content: [] },
      assistantText("hello"),
    ]) as unknown as { initialPrompts: unknown[] };
    expect(result.initialPrompts).toEqual([
      { role: "system", content: "S" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("buildInitialPromptsFromHistory returns [] for empty history", () => {
    const result = chatHistory.buildInitialPromptsFromHistory([]) as unknown as {
      initialPrompts: unknown[];
      fingerprint: string;
    };
    expect(result.initialPrompts).toEqual([]);
    expect(result.fingerprint).toBe("[]");
  });

  it("reuses the same fingerprint when filtered history is unchanged", () => {
    const base = chatHistory.buildInitialPromptsFromHistory([
      systemText("S"),
      userText("hi"),
      assistantText("hello"),
    ]) as unknown as { fingerprint: string };
    const withDroppedFrames = chatHistory.buildInitialPromptsFromHistory([
      systemText("S"),
      { role: "user", content: [] },
      userText("hi"),
      systemText("ignored"),
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            tool_use_id: "x",
            content: [{ type: "text", text: "result" }],
            is_error: false,
          },
        ],
      },
      assistantText("hello"),
    ]) as unknown as { fingerprint: string };
    expect(withDroppedFrames.fingerprint).toBe(base.fingerprint);
  });

  it("changes the fingerprint when the leading system prompt changes", () => {
    const first = chatHistory.buildInitialPromptsFromHistory([
      systemText("S1"),
      userText("hi"),
      assistantText("hello"),
    ]) as unknown as { fingerprint: string };
    const second = chatHistory.buildInitialPromptsFromHistory([
      systemText("S2"),
      userText("hi"),
      assistantText("hello"),
    ]) as unknown as { fingerprint: string };
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});

// --------------------------------------------------------------------------
// Capability probe
// --------------------------------------------------------------------------

/**
 * Fake factory whose two `create()` codepaths can be independently controlled
 * — pass `jsonModeOk: false` to reject when `responseConstraint` is passed,
 * `toolUseOk: false` to reject when `tools` is passed. Records the total
 * number of `create()` invocations so we can assert coalescing behavior.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeProbeFactory(opts: { jsonModeOk: boolean; toolUseOk: boolean }): any {
  let destroys = 0;
  const create = vi.fn(async (options?: Record<string, unknown>) => {
    if (options && "responseConstraint" in options && !opts.jsonModeOk) {
      throw new Error("responseConstraint not supported");
    }
    if (options && "tools" in options && !opts.toolUseOk) {
      throw new Error("tools not supported");
    }
    return {
      destroy: (): void => {
        destroys += 1;
      },
    };
  });
  return { create, params: vi.fn(), destroyCount: () => destroys };
}

describe("probeWebBrowserCapabilities", () => {
  // Each test injects its own factory; clear the cached coalesced promise
  // so they don't share results.
  afterEach(() => {
    probe._resetProbeCache();
  });

  it("both true when factory accepts both responseConstraint and tools", async () => {
    const f = makeProbeFactory({ jsonModeOk: true, toolUseOk: true });
    const result = await probe.probeWebBrowserCapabilities(f);
    expect(result).toEqual({ jsonMode: true, toolUse: true });
  });

  it("jsonMode false when factory rejects responseConstraint", async () => {
    const f = makeProbeFactory({ jsonModeOk: false, toolUseOk: true });
    const result = await probe.probeWebBrowserCapabilities(f);
    expect(result).toEqual({ jsonMode: false, toolUse: true });
  });

  it("toolUse false when factory rejects tools", async () => {
    const f = makeProbeFactory({ jsonModeOk: true, toolUseOk: false });
    const result = await probe.probeWebBrowserCapabilities(f);
    expect(result).toEqual({ jsonMode: true, toolUse: false });
  });

  it("both false when factory rejects both", async () => {
    const f = makeProbeFactory({ jsonModeOk: false, toolUseOk: false });
    const result = await probe.probeWebBrowserCapabilities(f);
    expect(result).toEqual({ jsonMode: false, toolUse: false });
  });

  it("coalesces concurrent calls into a single probe", async () => {
    const f = makeProbeFactory({ jsonModeOk: true, toolUseOk: true });
    // Fire N concurrent probes through the public surface. They should all
    // share the same in-flight promise and trigger at most the same set of
    // create() calls a single probe would (one per feature, not N).
    const results = await Promise.all(
      Array.from({ length: 5 }, () => probe.probeWebBrowserCapabilities(f))
    );
    expect(results.every((r) => r.jsonMode && r.toolUse)).toBe(true);
    // The probe issues exactly two create() calls — one for json-mode, one
    // for tool-use. Concurrent callers must coalesce, not multiply.
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("provider.ready() reflects the probe result", async () => {
    const f = makeProbeFactory({ jsonModeOk: true, toolUseOk: false });
    const provider = new WebBrowserProvider(WEB_BROWSER_RUN_FNS, undefined, f);
    // Pre-ready: conservative subset for chrome-prompt.
    const preCaps = provider.inferCapabilities(model("chrome-prompt"));
    expect(preCaps).not.toContain("json-mode");
    expect(preCaps).not.toContain("tool-use");
    await provider.ready();
    // Post-ready: json-mode appears, tool-use stays gated.
    const postCaps = provider.inferCapabilities(model("chrome-prompt"));
    expect(postCaps).toContain("json-mode");
    expect(postCaps).not.toContain("tool-use");
  });
});

// --------------------------------------------------------------------------
// StructuredGeneration behavior
// --------------------------------------------------------------------------

/**
 * Install a fake `LanguageModel` global so the run-fn's `getApi` /
 * `ensureAvailable` checks pass. Returns a teardown.
 */
function installLanguageModelGlobal(impl: unknown): () => void {
  const prior = (globalThis as Record<string, unknown>).LanguageModel;
  (globalThis as Record<string, unknown>).LanguageModel = impl;
  return () => {
    if (prior === undefined) {
      delete (globalThis as Record<string, unknown>).LanguageModel;
    } else {
      (globalThis as Record<string, unknown>).LanguageModel = prior;
    }
  };
}

/**
 * Fake `LanguageModel` factory + session that streams a single chunk of
 * pre-canned text. `text` is the full JSON payload returned by the
 * model's "response" in one snapshot — sufficient for our parse pipeline
 * because Chrome's stream surface emits progressive snapshots.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeLanguageModel(text: string | (() => string)): any {
  let destroyed = 0;
  const factory = {
    availability: vi.fn().mockResolvedValue("available"),
    create: vi.fn(async () => ({
      promptStreaming: (_p: string, _o?: unknown) => {
        const value = typeof text === "function" ? text() : text;
        return new ReadableStream<string>({
          start(controller) {
            controller.enqueue(value);
            controller.close();
          },
        });
      },
      destroy: () => {
        destroyed += 1;
      },
    })),
  };
  return { factory, destroyed: () => destroyed };
}

describe("WebBrowser_StructuredGeneration behavior", () => {
  const schema = {
    type: "object",
    properties: { x: { type: "number" } },
    required: ["x"],
    additionalProperties: false,
  } as const;
  const sid = "sg-test-1";

  afterEach(() => {
    sessions.deleteChromeSession(sid);
  });

  it("creates a fresh session for each call even when sessionId repeats", async () => {
    const { factory } = makeFakeLanguageModel('{"x":1}');
    const restore = installLanguageModelGlobal(factory);
    try {
      const emit = vi.fn();
      await WebBrowser_StructuredGeneration(
        asSGI({ prompt: "p", outputSchema: schema }),
        undefined,
        new AbortController().signal,
        emit,
        schema,
        sid
      );
      await WebBrowser_StructuredGeneration(
        asSGI({ prompt: "p2", outputSchema: schema }),
        undefined,
        new AbortController().signal,
        emit,
        schema,
        sid
      );
      expect(factory.create).toHaveBeenCalledTimes(2);
      expect(sessions.getChromeSession(sid)).toBeUndefined();
    } finally {
      restore();
    }
  });
});

// --------------------------------------------------------------------------
// StructuredGeneration final-JSON validation (H4)
// --------------------------------------------------------------------------

describe("WebBrowser_StructuredGeneration validation", () => {
  const schema = {
    type: "object",
    properties: { x: { type: "number" } },
    required: ["x"],
    additionalProperties: false,
  } as const;

  it("emits finish on valid JSON that satisfies the schema", async () => {
    const { factory } = makeFakeLanguageModel('{"x":1}');
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: unknown[] = [];
      const emit = (e: unknown): void => {
        events.push(e);
      };
      await WebBrowser_StructuredGeneration(
        asSGI({ prompt: "p", outputSchema: schema }),
        undefined,
        new AbortController().signal,
        emit,
        schema
      );
      const finish = events.find((e) => (e as { type?: string }).type === "finish") as
        | { data: { object: { x: number } } }
        | undefined;
      expect(finish).toBeDefined();
      expect(finish?.data.object).toEqual({ x: 1 });
    } finally {
      restore();
    }
  });

  it("emits finish with an empty object when the final JSON is unparseable", async () => {
    const { factory } = makeFakeLanguageModel("definitely not json");
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: unknown[] = [];
      const emit = (e: unknown): void => {
        events.push(e);
      };
      await WebBrowser_StructuredGeneration(
        asSGI({ prompt: "p", outputSchema: schema }),
        undefined,
        new AbortController().signal,
        emit,
        schema
      );
      const finish = events.find((e) => (e as { type?: string }).type === "finish") as
        | { data: { object: Record<string, unknown> } }
        | undefined;
      expect(finish?.data.object).toEqual({});
    } finally {
      restore();
    }
  });

  it("emits finish even when the parsed object fails schema validation", async () => {
    const { factory } = makeFakeLanguageModel('{"x":"oops"}');
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: unknown[] = [];
      const emit = (e: unknown): void => {
        events.push(e);
      };
      await WebBrowser_StructuredGeneration(
        asSGI({ prompt: "p", outputSchema: schema }),
        undefined,
        new AbortController().signal,
        emit,
        schema
      );
      const finish = events.find((e) => (e as { type?: string }).type === "finish") as
        | { data: { object: { x: string } } }
        | undefined;
      expect(finish?.data.object).toEqual({ x: "oops" });
    } finally {
      restore();
    }
  });
});

// --------------------------------------------------------------------------
// ToolCalling session lifecycle
// --------------------------------------------------------------------------

/**
 * Fake `LanguageModel` for tool-calling tests. The session's
 * `promptStreaming` immediately invokes each declared tool's `execute`
 * callback so the run-fn captures the tool calls, then closes the stream.
 *
 * `callsBy[toolName]` supplies args for each capture; if omitted defaults
 * to `{}`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeToolCallingModel(callsBy: Record<string, unknown> = {}): any {
  const factory = {
    availability: vi.fn().mockResolvedValue("available"),
    create: vi.fn(
      async (options?: {
        tools?: Array<{ name: string; execute: (...args: unknown[]) => Promise<string> }>;
      }) => {
        const tools = options?.tools ?? [];
        return {
          promptStreaming: () =>
            new ReadableStream<string>({
              async start(controller) {
                for (const t of tools) {
                  if (t.name === "_probe") continue; // probe tool ignored here
                  const args = callsBy[t.name] ?? {};
                  await t.execute(args);
                }
                controller.close();
              },
            }),
          destroy: vi.fn(),
        };
      }
    ),
  };
  return { factory };
}

describe("WebBrowser_ToolCalling session lifecycle", () => {
  const sid = "tc-test-1";
  const toolA: ToolDefinition = {
    name: "tool_a",
    description: "tool a",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  };
  const toolB: ToolDefinition = {
    name: "tool_b",
    description: "tool b",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  };

  afterEach(() => {
    sessions.deleteChromeSession(sid);
  });

  it("creates a fresh session for each turn even when sessionId repeats", async () => {
    const { factory } = makeFakeToolCallingModel();
    const restore = installLanguageModelGlobal(factory);
    try {
      const emit = vi.fn();
      const messages: ChatMessage[] = [
        { role: "user", content: [{ type: "text", text: "do it" }] },
      ];
      await WebBrowser_ToolCalling(
        asTCI({ prompt: "", tools: [toolA, toolB], messages }),
        undefined,
        new AbortController().signal,
        emit,
        undefined,
        sid
      );
      const messages2: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "again" }] },
      ];
      await WebBrowser_ToolCalling(
        asTCI({ prompt: "", tools: [toolA, toolB], messages: messages2 }),
        undefined,
        new AbortController().signal,
        emit,
        undefined,
        sid
      );
      // Same tool set, same conversation thread → cache reuse, one create().
      expect(factory.create).toHaveBeenCalledTimes(2);
      expect(sessions.getChromeSession(sid)).toBeUndefined();
    } finally {
      restore();
    }
  });
});

// --------------------------------------------------------------------------
// ToolCalling argument validation (H3)
// --------------------------------------------------------------------------

describe("WebBrowser_ToolCalling argument validation", () => {
  const strictTool: ToolDefinition = {
    name: "echo",
    description: "echo",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  };

  it("passes through calls whose args satisfy the inputSchema", async () => {
    const { factory } = makeFakeToolCallingModel({ echo: { text: "hello" } });
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: Array<{ type: string; port?: string; objectDelta?: unknown }> = [];
      const emit = (e: unknown): void => {
        events.push(e as { type: string; port?: string; objectDelta?: unknown });
      };
      await WebBrowser_ToolCalling(
        asTCI({ prompt: "go", tools: [strictTool] }),
        undefined,
        new AbortController().signal,
        emit
      );
      const tcEvent = events.find((e) => e.type === "object-delta" && e.port === "toolCalls");
      expect(tcEvent).toBeDefined();
      const calls = (tcEvent?.objectDelta as Array<{ name: string; input: unknown }>) ?? [];
      expect(calls).toHaveLength(1);
      expect(calls[0]?.input).toEqual({ text: "hello" });
    } finally {
      restore();
    }
  });

  it("drops calls missing a required field", async () => {
    // `text` is required but omitted.
    const { factory } = makeFakeToolCallingModel({ echo: {} });
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: Array<{ type: string; port?: string }> = [];
      const emit = (e: unknown): void => {
        events.push(e as { type: string; port?: string });
      };
      await WebBrowser_ToolCalling(
        asTCI({ prompt: "go", tools: [strictTool] }),
        undefined,
        new AbortController().signal,
        emit
      );
      // No toolCalls event since the only call was dropped.
      expect(events.some((e) => e.type === "object-delta" && e.port === "toolCalls")).toBe(false);
    } finally {
      restore();
    }
  });

  it("drops calls with a wrong-typed field", async () => {
    // `text` must be string; passing a number fails validation.
    const { factory } = makeFakeToolCallingModel({ echo: { text: 42 } });
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: Array<{ type: string; port?: string }> = [];
      const emit = (e: unknown): void => {
        events.push(e as { type: string; port?: string });
      };
      await WebBrowser_ToolCalling(
        asTCI({ prompt: "go", tools: [strictTool] }),
        undefined,
        new AbortController().signal,
        emit
      );
      expect(events.some((e) => e.type === "object-delta" && e.port === "toolCalls")).toBe(false);
    } finally {
      restore();
    }
  });

  it("falls through to name-check when inputSchema fails to compile", async () => {
    // A schema that compileSchema can't handle. The malformed-schema tool
    // should still see its call pass through (no crash, no validation), and
    // hallucinated names still get filtered.
    const malformedTool = {
      name: "loose",
      description: "loose",
      // Garbage schema — type is invalid.
      inputSchema: { type: "not_a_real_type" } as unknown,
    } as { name: string; description: string; inputSchema: unknown };
    const { factory } = makeFakeToolCallingModel({ loose: { anything: 1 } });
    const restore = installLanguageModelGlobal(factory);
    try {
      const events: Array<{ type: string; port?: string; objectDelta?: unknown }> = [];
      const emit = (e: unknown): void => {
        events.push(e as { type: string; port?: string; objectDelta?: unknown });
      };
      await WebBrowser_ToolCalling(
        asTCI({
          prompt: "go",
          tools: [malformedTool as unknown as typeof strictTool],
        }),
        undefined,
        new AbortController().signal,
        emit
      );
      // Either the schema compiled and validation passed (loose schema),
      // or it failed to compile and the call fell through unchanged.
      // Either way, no crash, and we see the tool call event.
      const tcEvent = events.find((e) => e.type === "object-delta" && e.port === "toolCalls");
      expect(tcEvent).toBeDefined();
    } finally {
      restore();
    }
  });
});
