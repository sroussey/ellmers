/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";

describe("the node entry", () => {
  it("registers the task class and no provider", async () => {
    // The four vendor adapters value-import this package to reach
    // `registerWebSearchProvider`, so whatever the entry registers is
    // registered by the act of importing `@workglow/anthropic/web-search`:
    // brave lands in front of "auto" routing in an app that asked for
    // anthropic, and a SearXNG instance is stood up from an environment
    // variable nobody read.
    //
    // The module graph has to be fresh for the side effects to run again — the
    // registry is a module singleton and the shared graph loaded this entry
    // long before any test could clear it.
    vi.resetModules();
    process.env.WEB_SEARCH_SEARXNG_URL = "https://searx.uninvited.example";
    try {
      const { WebSearchProviderRegistry } = await import("../WebSearchProviderRegistry");
      const { WebSearchTask } = await import("../WebSearchTask");
      const { TaskRegistry } = await import("@workglow/task-graph");
      await import("../node");

      expect(WebSearchProviderRegistry.list()).toEqual([]);
      expect(TaskRegistry.all.get(WebSearchTask.type)).toBe(WebSearchTask);
    } finally {
      delete process.env.WEB_SEARCH_SEARXNG_URL;
      vi.resetModules();
    }
  });
});
