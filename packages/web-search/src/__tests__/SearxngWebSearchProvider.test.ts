/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { SearxngWebSearchProvider } from "../providers/SearxngWebSearchProvider";

const PAYLOAD = {
  query: "cats",
  results: [
    {
      title: "Cats",
      url: "https://en.wikipedia.org/wiki/Cat",
      content: "The cat is a domestic species.",
      score: 1.5,
      publishedDate: "2026-01-02T00:00:00Z",
    },
  ],
};

function contextWithResponse(payload: unknown, spy?: (input: unknown) => void): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: () => ({
      run: async (input: unknown) => {
        spy?.(input);
        return { json: payload, metadata: { status: 200 } };
      },
    }),
  } as unknown as IExecuteContext;
}

describe("SearxngWebSearchProvider", () => {
  it("declares no answer, no content and no date filtering", () => {
    const c = new SearxngWebSearchProvider("https://searx.example").capabilities;
    expect(c.answer).toBe(false);
    expect(c.content).toBe(false);
    expect(c.dateFilter).toBe(false);
    expect(c.domainFilter).toBe("query-operator");
  });

  it("requests format=json against the configured base url", async () => {
    const seen = vi.fn();
    await new SearxngWebSearchProvider("https://searx.example").search(
      { query: "cats" },
      contextWithResponse(PAYLOAD, seen)
    );
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    expect(url.origin + url.pathname).toBe("https://searx.example/search");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("q")).toBe("cats");
  });

  it("tolerates a base url with a trailing slash", async () => {
    const seen = vi.fn();
    await new SearxngWebSearchProvider("https://searx.example/").search(
      { query: "cats" },
      contextWithResponse(PAYLOAD, seen)
    );
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    expect(url.pathname).toBe("/search");
  });

  it("sends no credential — a self-hosted instance needs none", async () => {
    const seen = vi.fn();
    await new SearxngWebSearchProvider("https://searx.example").search(
      { query: "cats", credentialKey: "unused" },
      contextWithResponse(PAYLOAD, seen)
    );
    expect((seen.mock.calls[0][0] as { credential_key?: string }).credential_key).toBeUndefined();
  });

  it("normalizes results", async () => {
    const out = await new SearxngWebSearchProvider("https://searx.example").search(
      { query: "cats" },
      contextWithResponse(PAYLOAD)
    );
    expect(out.results[0]).toEqual({
      title: "Cats",
      url: "https://en.wikipedia.org/wiki/Cat",
      snippet: "The cat is a domestic species.",
      content: undefined,
      publishedDate: "2026-01-02T00:00:00Z",
      score: 1.5,
      favicon: undefined,
    });
  });

  it("truncates to maxResults, which the instance does not enforce", async () => {
    const many = {
      results: [1, 2, 3, 4, 5].map((n) => ({ title: `t${n}`, url: `https://e/${n}` })),
    };
    const out = await new SearxngWebSearchProvider("https://searx.example").search(
      { query: "cats", maxResults: 2 },
      contextWithResponse(many)
    );
    expect(out.results).toHaveLength(2);
  });

  it("explains that format=json is disabled when the body is not the expected shape", async () => {
    await expect(
      new SearxngWebSearchProvider("https://searx.example").search(
        { query: "cats" },
        contextWithResponse("<!DOCTYPE html><html></html>")
      )
    ).rejects.toThrow(/format=json/);
  });

  it("rejects a base url that is not http(s)", () => {
    expect(() => new SearxngWebSearchProvider("ftp://searx.example")).toThrow(/http/);
  });
});
