/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "@workglow/ai"; // Trigger Workflow prototype extensions
import { documentUpsert } from "@workglow/ai";
import { createKnowledgeBase, KnowledgeBase, StructuralParser } from "@workglow/knowledge-base";
import type { DocumentMetadata } from "@workglow/knowledge-base";
import { setLogger, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

type MemSnapshot = ReturnType<typeof process.memoryUsage>;
const mb = (n: number) => (n / 1024 / 1024).toFixed(0) + "MB";
const signedMb = (n: number) => (n >= 0 ? "+" : "") + (n / 1024 / 1024).toFixed(0) + "MB";
const snapMem = (): MemSnapshot => process.memoryUsage();
const reportMem = (label: string, start?: MemSnapshot) => {
  const m = process.memoryUsage();
  const fmt = (cur: number, base: number | undefined) =>
    base === undefined ? mb(cur) : `${mb(cur)} (${signedMb(cur - base)})`;
  process.stderr.write(
    `[${label}] MEM rss=${fmt(m.rss, start?.rss)} heap=${fmt(m.heapUsed, start?.heapUsed)} ext=${fmt(m.external, start?.external)} ab=${fmt(m.arrayBuffers, start?.arrayBuffers)}\n`
  );
};
const reportTime = (label: string, started: number) => {
  process.stderr.write(`[${label}] TIME ${((Date.now() - started) / 1000).toFixed(2)}s\n`);
};

setLogger(getTestingLogger());

let _testStarted = 0;
let _testStartMem: MemSnapshot;
beforeEach(() => {
  _testStarted = Date.now();
  _testStartMem = snapMem();
});
afterEach((ctx) => {
  reportTime(`doc-upsert: ${ctx.task.name}`, _testStarted);
  reportMem(`doc-upsert: ${ctx.task.name}`, _testStartMem);
});

describe("DocumentUpsertTask", () => {
  let kb: KnowledgeBase;

  beforeEach(async () => {
    kb = await createKnowledgeBase({
      name: `test-doc-upsert-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
  });

  afterEach(() => {
    kb.destroy();
  });

  async function makeTree(title: string) {
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, "# Test\n\nContent.", title);
    return { doc_id, root };
  }

  it("accepts the legacy title-only shortcut", async () => {
    const { doc_id, root } = await makeTree("Legacy Title");
    await documentUpsert({
      knowledgeBase: kb,
      doc_id,
      documentTree: root,
      title: "Legacy Title",
    });
    const doc = await kb.getDocument(doc_id);
    expect(doc?.metadata.title).toBe("Legacy Title");
  });

  it("accepts a metadata object with title plus extras and persists every field", async () => {
    const { doc_id, root } = await makeTree("Metadata Title");
    const metadata: DocumentMetadata = {
      title: "Metadata Title",
      sourceUri: "/raw/workglow.dev/blog/post/example.mdx",
      createdAt: "2026-05-04",
      // Open schema (additionalProperties: true) — extras pass through unchanged.
      author: "Workglow Team",
      tags: ["task-graph"],
    } as DocumentMetadata;
    await documentUpsert({ knowledgeBase: kb, doc_id, documentTree: root, metadata });
    const doc = await kb.getDocument(doc_id);
    expect(doc?.metadata.title).toBe("Metadata Title");
    expect(doc?.metadata.sourceUri).toBe("/raw/workglow.dev/blog/post/example.mdx");
    expect((doc?.metadata as Record<string, unknown>).author).toBe("Workglow Team");
    expect((doc?.metadata as Record<string, unknown>).tags).toEqual(["task-graph"]);
  });

  it("lets explicit title override metadata.title when both are provided", async () => {
    const { doc_id, root } = await makeTree("Original");
    await documentUpsert({
      knowledgeBase: kb,
      doc_id,
      documentTree: root,
      title: "Override",
      metadata: { title: "Original", sourceUri: "/x.mdx" },
    });
    const doc = await kb.getDocument(doc_id);
    expect(doc?.metadata.title).toBe("Override");
    expect(doc?.metadata.sourceUri).toBe("/x.mdx");
  });

  it("throws when neither title nor metadata.title is provided", async () => {
    const { doc_id, root } = await makeTree("placeholder");
    await expect(
      documentUpsert({
        knowledgeBase: kb,
        doc_id,
        documentTree: root,
        // Deliberately missing both title fields. We cast through unknown to
        // bypass the input typing for this negative test, but the runtime check
        // in execute() should reject it.
        metadata: { sourceUri: "/x.mdx" } as unknown as DocumentMetadata,
      })
    ).rejects.toThrow(/title is required/i);
  });
});
