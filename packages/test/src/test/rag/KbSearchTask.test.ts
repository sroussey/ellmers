/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { kbSearch } from "@workglow/ai";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { uuid4 } from "@workglow/util";
import { describe, expect, it, vi } from "vitest";

/**
 * Tests that `KbSearchTask` forwards `scoreThreshold` to `kb.search`.
 * The task is the public surface that downstream callers wire into a
 * workflow; if the schema accepts `scoreThreshold` but `execute` drops
 * it, callers silently get unfiltered results.
 */
describe("KbSearchTask scoreThreshold forwarding", () => {
  /**
   * Build a KB whose `search` method is replaced with a spy that returns
   * an empty result list. The spy lets us assert exactly which options
   * the task hands down.
   */
  async function makeKbWithSearchSpy() {
    const kb = await createKnowledgeBase({
      name: `kb-search-task-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
    const searchSpy = vi.spyOn(kb, "search").mockResolvedValue([]);
    return { kb, searchSpy };
  }

  it("forwards `scoreThreshold` to kb.search when provided", async () => {
    const { kb, searchSpy } = await makeKbWithSearchSpy();

    await kbSearch({
      knowledgeBase: kb,
      query: "hello",
      topK: 3,
      scoreThreshold: 0.42,
    });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const [forwardedQuery, forwardedOpts] = searchSpy.mock.calls[0];
    expect(forwardedQuery).toBe("hello");
    expect(forwardedOpts).toMatchObject({ topK: 3, scoreThreshold: 0.42 });
  });

  it("passes `scoreThreshold: undefined` to kb.search when omitted", async () => {
    const { kb, searchSpy } = await makeKbWithSearchSpy();

    await kbSearch({
      knowledgeBase: kb,
      query: "hello",
      topK: 3,
    });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const [, forwardedOpts] = searchSpy.mock.calls[0];
    // Property may either be absent or explicitly undefined; both
    // behave identically downstream. What we really care about is
    // that it's NOT a stale value carried over from a previous call.
    expect((forwardedOpts as { scoreThreshold?: number }).scoreThreshold).toBeUndefined();
  });

  it("threads run context (signal) to kb.search", async () => {
    const { kb, searchSpy } = await makeKbWithSearchSpy();

    await kbSearch({ knowledgeBase: kb, query: "hello" });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const call = searchSpy.mock.calls[0];
    // Third argument is the runConfig extracted from IExecuteContext.
    const forwardedRunConfig = call[2];
    expect(forwardedRunConfig).toBeDefined();
    expect(forwardedRunConfig).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
