/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  SEARXNG_BASE_URL_ENV,
  SearxngWebSearchProvider,
} from "../providers/SearxngWebSearchProvider";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";
import { WebSearchTask } from "../WebSearchTask";

const baseUrl = process.env[SEARXNG_BASE_URL_ENV];

describe.skipIf(!baseUrl)("SearxngWebSearchProvider (live)", () => {
  it("returns real results through the task", async () => {
    WebSearchProviderRegistry.clear();
    WebSearchProviderRegistry.register(new SearxngWebSearchProvider(baseUrl!));
    const out = await new WebSearchTask().run({
      query: "workglow",
      provider: "searxng",
      maxResults: 5,
    });
    expect(out.provider).toBe("searxng");
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.length).toBeLessThanOrEqual(5);
    for (const r of out.results) {
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("restricts to a domain through the site: translation", async () => {
    WebSearchProviderRegistry.clear();
    WebSearchProviderRegistry.register(new SearxngWebSearchProvider(baseUrl!));
    const out = await new WebSearchTask().run({
      query: "cat",
      provider: "searxng",
      includeDomains: ["wikipedia.org"],
      maxResults: 5,
    });
    expect(out.query).toContain("site:wikipedia.org");
  });
});
