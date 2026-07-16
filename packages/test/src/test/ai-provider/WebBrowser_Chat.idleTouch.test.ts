/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression test for WebBrowser_Chat's idle-eviction interaction with the
 * unified session store.
 *
 * The session store auto-evicts entries after `WEB_BROWSER_SESSION_IDLE_MS`
 * (30 min) of inactivity. Before this fix, a single chat turn whose stream
 * took longer than the idle window to finish (long generations, slow GPU,
 * paused tab + resume) would have its CACHED entry destroyed mid-stream by
 * the idle timer, leaving the next turn to look up a now-missing session.
 *
 * The run-fn now calls `touchWebBrowserSession(sessionId)` on every
 * `text-delta` event passed through `trackingEmit`, so any active model
 * output defers the idle timer.
 *
 * We assert two things:
 *  1. While the stream is still emitting deltas, the cached session survives
 *     past the 30-minute idle threshold (advance 25 min between two chunks).
 *  2. The idle eviction is *not* broken outright — once the stream completes
 *     and no further activity occurs, the session IS eventually evicted at
 *     the 30-minute mark.
 */

import type { AiChatProviderInput, ChatMessage } from "@workglow/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceFakeTimers } from "../helpers/advanceFakeTimers";

const {
  WEB_BROWSER_SESSION_IDLE_MS,
  WebBrowser_Chat,
  resetWebBrowserSessionsForTests,
  sessions: { getChromeSession, setChromeSession },
} = _testOnly;

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

const userMsg = (text: string): ChatMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

/**
 * A pumpable ReadableStream<string> the test can drive chunk-by-chunk.
 *
 * Chrome's streaming surface emits *progressive snapshots* (each chunk
 * contains the full accumulated text so far), so we send strictly extending
 * strings to satisfy `snapshotStreamToTextDeltas`' prefix check and produce
 * the `text-delta` events that drive the touch path.
 */
function makeControllableStream(): {
  stream: ReadableStream<string>;
  push: (chunk: string) => void;
  close: () => void;
} {
  let ctrl!: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start(controller) {
      ctrl = controller;
    },
  });
  return {
    stream,
    push: (chunk) => ctrl.enqueue(chunk),
    close: () => ctrl.close(),
  };
}

describe("WebBrowser_Chat idle-touch on text-delta", () => {
  const sid = "idle-touch-test-1";

  afterEach(() => {
    resetWebBrowserSessionsForTests();
    vi.useRealTimers();
  });

  it("active streaming defers idle eviction past the 30-minute window", async () => {
    vi.useFakeTimers();

    // Driver stream we control from the test.
    const { stream, push, close } = makeControllableStream();
    // Fake LanguageModel: the cached session's `promptStreaming` returns our
    // pumpable stream. The factory is also wired so any unexpected fresh
    // create() is observable; we don't expect it to fire.
    const cachedDestroy = vi.fn();
    const cachedPromptStreaming = vi.fn(() => stream);
    const cachedSession = {
      destroy: cachedDestroy,
      promptStreaming: cachedPromptStreaming,
    } as unknown as LanguageModel;

    const freshDestroy = vi.fn();
    const factory = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () => ({
        destroy: freshDestroy,
        promptStreaming: vi.fn(),
      })),
    };
    const restore = installLanguageModelGlobal(factory);

    // Pre-populate the chat-cache: messageCount=0 so the run-fn reuses this
    // entry when called with a single trailing user message (lastUserIdx=0,
    // expectedPriorCount=0). This is the only way to exercise the cached
    // path without a real Chrome global.
    setChromeSession(sid, {
      session: cachedSession,
      modelKey: "gemini-nano",
      messageCount: 0,
    });
    // Sanity: idle timer is armed at insertion time.
    expect(getChromeSession(sid)).toBeDefined();

    try {
      const emit = vi.fn();
      const turn: ChatMessage[] = [userMsg("write me a long answer please")];

      // Drive the run-fn concurrently with our chunk pumping.
      // Cast: the run-fn only reads input.messages (and optionally input.temperature)
      // at runtime; AiChatProviderInput requires model+prompt at the schema layer,
      // which the dispatcher provides but is irrelevant for this unit test.
      const runP = WebBrowser_Chat(
        { messages: turn } as unknown as AiChatProviderInput,
        undefined,
        new AbortController().signal,
        emit,
        undefined,
        { sessionId: sid }
      );

      // First chunk (progressive snapshot: chunk 1).
      push("hello");
      await advanceFakeTimers(0);
      // Sanity: a text-delta was emitted, so the touch path ran.
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "text-delta" }));

      // 25 minutes pass with NO additional output — within idle window.
      await advanceFakeTimers(25 * 60_000);
      expect(getChromeSession(sid)).toBeDefined();
      expect(cachedDestroy).not.toHaveBeenCalled();

      // Another chunk arrives — this resets the idle timer.
      push("hello world");
      await advanceFakeTimers(0);

      // Another 25 min — this would total 50 min from the seed time, well
      // past the 30-min idle window. Without the per-delta touch the cached
      // session would have been destroyed somewhere in here. With the fix,
      // the second push reset the timer to t+25min, so we're still within
      // the window.
      await advanceFakeTimers(25 * 60_000);
      expect(getChromeSession(sid)).toBeDefined();
      expect(cachedDestroy).not.toHaveBeenCalled();

      // Close the stream so the run-fn finishes.
      close();
      await advanceFakeTimers(0);
      await runP;

      // The cached session reference survives — the run-fn's `setChromeSession`
      // after a successful prompt replaces the entry with the SAME session
      // handle (cache transfer), keeping it alive.
      expect(getChromeSession(sid)).toBeDefined();
      expect(cachedDestroy).not.toHaveBeenCalled();
      expect(factory.create).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("post-stream idle eviction still fires after 30 minutes of true silence", async () => {
    vi.useFakeTimers();

    // One-shot stream: emit a single snapshot then close. After the run-fn
    // returns, the cache holds the session under its full idle timer.
    const cachedDestroy = vi.fn();
    const promptStreaming = vi.fn(
      () =>
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue("done");
            controller.close();
          },
        })
    );
    const cachedSession = {
      destroy: cachedDestroy,
      promptStreaming,
    } as unknown as LanguageModel;
    const factory = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(),
    };
    const restore = installLanguageModelGlobal(factory);

    setChromeSession(sid, {
      session: cachedSession,
      modelKey: "gemini-nano",
      messageCount: 0,
    });

    try {
      const emit = vi.fn();
      await WebBrowser_Chat(
        { messages: [userMsg("hi")] } as unknown as AiChatProviderInput,
        undefined,
        new AbortController().signal,
        emit,
        undefined,
        { sessionId: sid }
      );
      // Cached after the turn, with a fresh idle timer running.
      expect(getChromeSession(sid)).toBeDefined();

      // Advance to just before the idle threshold — still alive.
      await advanceFakeTimers(WEB_BROWSER_SESSION_IDLE_MS - 1, { flush: false });
      expect(getChromeSession(sid)).toBeDefined();

      // Cross the threshold — eviction fires, session is destroyed.
      await advanceFakeTimers(1);
      expect(cachedDestroy).toHaveBeenCalledOnce();
      expect(getChromeSession(sid)).toBeUndefined();
    } finally {
      restore();
    }
  });
});
