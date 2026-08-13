/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hierarchicalChunker } from "@workglow/ai";
import { estimateTokens, StructuralParser } from "@workglow/knowledge-base";
import { Workflow } from "@workglow/task-graph";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

import { report, snap } from "../../binding/testTiming";

describe("HierarchicalChunker", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("HierarchicalChunkerTask", () => {
    it("should chunk a simple document hierarchically", async () => {
      const s = snap();
      const markdown = `# Section 1

  This is a paragraph that should fit in one chunk.

  # Section 2

  This is another paragraph.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const result = await hierarchicalChunker({
        doc_id: doc_id,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      });

      expect(result.chunks).toBeDefined();
      expect(result.text).toBeDefined();
      expect(result.count).toBeGreaterThan(0);
      expect(result.chunks.length).toBe(result.count);
      expect(result.text.length).toBe(result.count);

      // Each chunk should have required fields
      for (const chunk of result.chunks) {
        expect(chunk.chunkId).toBeDefined();
        expect(chunk.doc_id).toBe(doc_id);
        expect(chunk.text).toBeDefined();
        expect(chunk.nodePath).toBeDefined();
        expect(chunk.nodePath.length).toBeGreaterThan(0);
        expect(chunk.depth).toBeGreaterThanOrEqual(0);
      }
      report("hier-chunk: simple", s);
    });

    it("should respect token budgets", async () => {
      const s = snap();
      // Create a long text that requires splitting
      const longText = "Lorem ipsum dolor sit amet. ".repeat(100);
      const markdown = `# Section\n\n${longText}`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Long");

      const maxTokens = 100;
      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens,
        overlap: 10,
        strategy: "hierarchical",
      });

      // Should create multiple chunks
      expect(result.count).toBeGreaterThan(1);

      // Each chunk should respect token budget
      for (const chunk of result.chunks) {
        const tokens = estimateTokens(chunk.text);
        expect(tokens).toBeLessThanOrEqual(maxTokens);
      }
      report("hier-chunk: token-budget", s);
    });

    it("should create overlapping chunks", async () => {
      const s = snap();
      const text = "Word ".repeat(200);
      const markdown = `# Section\n\n${text}`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Overlap");

      const maxTokens = 50;
      const overlap = 10;
      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens,
        overlap,
        strategy: "hierarchical",
      });

      // Should have multiple chunks
      expect(result.count).toBeGreaterThan(1);

      // Check for overlap in text content
      if (result.chunks.length > 1) {
        const chunk0 = result.chunks[0].text;
        const chunk1 = result.chunks[1].text;

        // Extract end of first chunk
        const chunk0End = chunk0.substring(Math.max(0, chunk0.length - 50));
        // Check if beginning of second chunk overlaps
        const hasOverlap = chunk1.includes(chunk0End.substring(0, 20));

        expect(hasOverlap).toBe(true);
      }
      report("hier-chunk: overlap", s);
    });

    it("should handle flat strategy", async () => {
      const s = snap();
      const markdown = `# Section 1

  Paragraph 1.

  # Section 2

  Paragraph 2.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Flat");

      const result = await new Workflow()
        .hierarchicalChunker({
          doc_id,
          documentTree: root,
          maxTokens: 512,
          overlap: 50,
          strategy: "flat",
        })
        .run();

      // Flat strategy should still produce chunks
      expect(result.count).toBeGreaterThan(0);
      report("hier-chunk: flat-strategy", s);
    });

    it("should maintain node paths in chunks", async () => {
      const s = snap();
      const markdown = `# Section 1

  ## Subsection 1.1

  Paragraph content.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Paths");

      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      });

      // Check that chunks have node paths
      for (const chunk of result.chunks) {
        expect(chunk.nodePath).toBeDefined();
        expect(Array.isArray(chunk.nodePath)).toBe(true);
        expect(chunk.nodePath.length).toBeGreaterThan(0);

        // First element should be root node ID
        expect(chunk.nodePath[0]).toBe(root.nodeId);
      }
      report("hier-chunk: node-paths", s);
    });

    it("prepends a section-only heading breadcrumb (excludes doc root title)", async () => {
      const s = snap();
      const markdown = `# Outer Section

## Inner Subsection

Body text under the inner subsection.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "DocTitle");

      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      });

      expect(result.count).toBeGreaterThan(0);
      for (const chunk of result.chunks) {
        // Section breadcrumb only; doc root title must NOT appear inside chunk text
        // (it lives on metadata.title and was leaking into URL hallucinations
        // when small models pattern-matched it onto the section slug).
        expect(chunk.text.startsWith("Outer Section > Inner Subsection\n\n")).toBe(true);
        expect(chunk.text.includes("DocTitle")).toBe(false);
      }
      expect(
        result.chunks.some((c) => c.text.includes("Body text under the inner subsection"))
      ).toBe(true);
      report("hier-chunk: breadcrumb", s);
    });

    it("keeps prefix+body within the chunk token budget when splitting long leaves", async () => {
      const s = snap();
      // Long body forces multiple chunks; breadcrumb tokens must be charged against
      // the budget so no chunk exceeds maxTokens after prepending the prefix.
      const longText = "Lorem ipsum dolor sit amet. ".repeat(100);
      const markdown = `# Section\n\n${longText}`;
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Budget");

      const maxTokens = 100;
      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens,
        overlap: 10,
        strategy: "hierarchical",
      });

      expect(result.count).toBeGreaterThan(1);
      for (const chunk of result.chunks) {
        // Section breadcrumb (without doc root title) must be present on every chunk,
        // including continuation chunks.
        expect(chunk.text.startsWith("Section\n\n")).toBe(true);
        // And the whole chunk (prefix + body) must respect the token budget.
        expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(maxTokens);
      }
      report("hier-chunk: prefix-budget", s);
    });

    it("stamps sectionTitles onto every chunk so the chat layer can build #anchor URLs", async () => {
      const s = snap();
      const markdown = `# Outer Section

## Inner Subsection

Body text under the inner subsection.

## Another Subsection

More body text.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Anchors");

      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      });

      expect(result.count).toBeGreaterThan(0);
      // Each chunk should carry the section breadcrumb leading down to its leaf.
      // The doc root title ("Anchors") is intentionally NOT included — see
      // chunkHierarchically comments.
      for (const chunk of result.chunks) {
        expect(chunk.sectionTitles).toBeDefined();
        expect(Array.isArray(chunk.sectionTitles)).toBe(true);
        expect((chunk.sectionTitles as string[])[0]).toBe("Outer Section");
        expect((chunk.sectionTitles as string[]).length).toBeGreaterThanOrEqual(1);
      }
      const innerChunk = result.chunks.find((c) =>
        c.text.includes("Body text under the inner subsection")
      );
      expect(innerChunk).toBeDefined();
      expect(innerChunk!.sectionTitles).toEqual(["Outer Section", "Inner Subsection"]);
      const otherChunk = result.chunks.find((c) => c.text.includes("More body text"));
      expect(otherChunk).toBeDefined();
      expect(otherChunk!.sectionTitles).toEqual(["Outer Section", "Another Subsection"]);
      report("hier-chunk: section-titles", s);
    });

    it("does not prepend the document title in flat strategy", async () => {
      const s = snap();
      const markdown = `# Section 1

Paragraph 1.

# Section 2

Paragraph 2.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "FlatDoc");

      // Use the direct helper (strongly typed) rather than the Workflow
      // chain — the chain's `.run()` returns a wider type that loses the
      // `chunks: ChunkRecord[]` shape, and we need to inspect chunk.text.
      const result = await hierarchicalChunker({
        doc_id,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "flat",
      });

      expect(result.count).toBeGreaterThan(0);
      // Doc title must not leak into chunk text — it's metadata, and embedding
      // the brand-name title in chunk content was producing URL hallucinations.
      for (const chunk of result.chunks) {
        expect(chunk.text.includes("FlatDoc")).toBe(false);
      }
      report("hier-chunk: flat-no-title", s);
    });
  });

  describe("Token estimation", () => {
    it("should estimate tokens approximately", () => {
      const s = snap();
      const text = "This is a test string";
      const tokens = estimateTokens(text);

      // Rough approximation: 1 token ~= 4 characters
      const expected = Math.ceil(text.length / 4);
      expect(tokens).toBe(expected);
      report("token-est: approximate", s);
    });

    it("should handle empty strings", () => {
      const s = snap();
      const tokens = estimateTokens("");
      expect(tokens).toBe(0);
      report("token-est: empty", s);
    });

    it("should increase token count with text length", () => {
      const s = snap();
      const shortText = "Hello";
      const longText = "Hello world this is a much longer text";

      const shortTokens = estimateTokens(shortText);
      const longTokens = estimateTokens(longText);

      expect(longTokens).toBeGreaterThan(shortTokens);
      report("token-est: length-proportional", s);
    });
  });
});
