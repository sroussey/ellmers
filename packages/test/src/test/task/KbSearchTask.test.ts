/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { KbSearchTask, registerAiTasks } from "@workglow/ai";
import type { ChunkSearchResult, KnowledgeBase } from "@workglow/knowledge-base";
import { TaskRegistry } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

function makeFakeKb(results: ChunkSearchResult[]): KnowledgeBase {
  const calls: Array<{ query: string; opts: unknown }> = [];
  const fake = {
    title: "Fake KB",
    description: "fake",
    search: async (query: string, opts: unknown) => {
      calls.push({ query, opts });
      return results;
    },
    _calls: calls,
  } as unknown as KnowledgeBase;
  return fake;
}

describe("KbSearchTask — schema and registration", () => {
  it("has required static properties", () => {
    expect(KbSearchTask.type).toBe("KbSearchTask");
    expect(KbSearchTask.category).toBe("RAG");
    expect(KbSearchTask.cacheable).toBe(true);
  });

  it("declares input schema with required knowledgeBase and query", () => {
    const schema = KbSearchTask.inputSchema() as any;
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("knowledgeBase");
    expect(schema.required).toContain("query");
    expect(schema.properties.topK.default).toBe(5);
  });

  it("declares output schema with results and count", () => {
    const schema = KbSearchTask.outputSchema() as any;
    expect(schema.properties.results).toBeDefined();
    expect(schema.properties.count).toBeDefined();
  });

  it("registers via registerAiTasks()", () => {
    registerAiTasks();
    expect(TaskRegistry.all.get("KbSearchTask")).toBe(KbSearchTask);
  });
});

describe("KbSearchTask — execute()", () => {
  it("calls kb.search with the query and topK and returns results + count", async () => {
    const fakeResults: ChunkSearchResult[] = [
      { chunk_id: "c1", doc_id: "d1", score: 0.9, metadata: { text: "foo" } } as any,
      { chunk_id: "c2", doc_id: "d2", score: 0.8, metadata: { text: "bar" } } as any,
    ];
    const kb = makeFakeKb(fakeResults);
    const task = new KbSearchTask();
    const out = await task.run({ knowledgeBase: kb, query: "what is foo", topK: 3 });
    expect(out.count).toBe(2);
    expect(out.results).toEqual(fakeResults);
    // @ts-expect-error — test helper
    expect(kb._calls[0].query).toBe("what is foo");
    // @ts-expect-error — test helper
    expect(kb._calls[0].opts).toMatchObject({ topK: 3 });
  });

  it("forwards the optional filter to kb.search", async () => {
    const kb = makeFakeKb([]);
    const task = new KbSearchTask();
    await task.run({ knowledgeBase: kb, query: "q", topK: 1, filter: { kind: "help" } });
    // @ts-expect-error — test helper
    expect(kb._calls[0].opts).toMatchObject({ topK: 1, filter: { kind: "help" } });
  });

  it("defaults topK to 5 when omitted", async () => {
    const kb = makeFakeKb([]);
    const task = new KbSearchTask();
    await task.run({ knowledgeBase: kb, query: "q" });
    // @ts-expect-error — test helper
    expect(kb._calls[0].opts).toMatchObject({ topK: 5 });
  });
});
