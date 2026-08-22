/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { beforeEach, describe, expect, it } from "vitest";
import { registerBuiltInWebSearchProviders, registerWebSearchTasks } from "../common";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";
import { WebSearchTask } from "../WebSearchTask";

describe("web-search entries", () => {
  beforeEach(() => WebSearchProviderRegistry.clear());

  it("registers the task class under its type name", () => {
    registerWebSearchTasks();
    expect(TaskRegistry.all.get(WebSearchTask.type)).toBe(WebSearchTask);
  });

  it("registers Brave and Tavily without configuration", () => {
    registerBuiltInWebSearchProviders();
    const names = WebSearchProviderRegistry.list().map((p) => p.name);
    expect(names).toContain("brave");
    expect(names).toContain("tavily");
  });

  it("registers SearXNG only when a base url is supplied", () => {
    registerBuiltInWebSearchProviders();
    expect(WebSearchProviderRegistry.get("searxng")).toBeUndefined();
    WebSearchProviderRegistry.clear();
    registerBuiltInWebSearchProviders({ searxngBaseUrl: "https://searx.example" });
    expect(WebSearchProviderRegistry.get("searxng")).toBeDefined();
  });

  it("reads the SearXNG base url from the environment when not passed", () => {
    process.env.WEB_SEARCH_SEARXNG_URL = "https://searx.env.example";
    try {
      registerBuiltInWebSearchProviders();
      expect(WebSearchProviderRegistry.get("searxng")?.endpoint).toBe(
        "https://searx.env.example/search"
      );
    } finally {
      delete process.env.WEB_SEARCH_SEARXNG_URL;
    }
  });
});
