/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SectionNode } from "@workglow/knowledge-base";
import { NodeKind, StructuralParser } from "@workglow/knowledge-base";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

import { report, snap } from "../../binding/testTiming";

describe("StructuralParser", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("Markdown parsing", () => {
    it("should parse markdown with headers into hierarchical tree", async () => {
      const s = snap();
      const markdown = `# Main Title

This is the intro.

## Section 1

Content for section 1.

## Section 2

Content for section 2.

### Subsection 2.1

Nested content.`;

      const doc_id = "doc_test123";
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test Document");

      expect(root.kind).toBe(NodeKind.DOCUMENT);
      expect(root.children.length).toBeGreaterThan(0);

      // Find sections - parser should create sections for headers
      const sections = root.children.filter((child) => child.kind === NodeKind.SECTION);
      expect(sections.length).toBeGreaterThan(0);

      // Should have some children (sections or paragraphs)
      expect(root.children.length).toBeGreaterThanOrEqual(1);
      report("struct-parser: md-hierarchy", s);
    });

    it("should preserve source offsets", async () => {
      const s = snap();
      const markdown = `# Title

Paragraph one.

Paragraph two.`;

      const doc_id = "doc_test456";
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      expect(root.range.startOffset).toBe(0);
      expect(root.range.endOffset).toBe(markdown.length);

      // Check children have valid offsets
      for (const child of root.children) {
        expect(child.range.startOffset).toBeGreaterThanOrEqual(0);
        expect(child.range.endOffset).toBeLessThanOrEqual(markdown.length);
        expect(child.range.endOffset).toBeGreaterThan(child.range.startOffset);
      }
      report("struct-parser: offsets", s);
    });

    it("should handle nested sections correctly", async () => {
      const s = snap();
      const markdown = `# Level 1

Content.

## Level 2

More content.

### Level 3

Deep content.`;

      const doc_id = "doc_test789";
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Nested Test");

      // Find first section (Level 1)
      const level1 = root.children.find(
        (c): c is SectionNode => c.kind === NodeKind.SECTION && c.level === 1
      );
      expect(level1).toBeDefined();

      // It should have children including level 2
      const level2 = level1!.children.find(
        (c): c is SectionNode => c.kind === NodeKind.SECTION && c.level === 2
      );
      expect(level2).toBeDefined();

      // Level 2 should have level 3
      const level3 = level2!.children.find(
        (c): c is SectionNode => c.kind === NodeKind.SECTION && c.level === 3
      );
      expect(level3).toBeDefined();
      report("struct-parser: nested-sections", s);
    });
  });

  describe("Plain text parsing", () => {
    it("should parse plain text into paragraphs", async () => {
      const s = snap();
      const text = `First paragraph here.

Second paragraph here.

Third paragraph here.`;

      const doc_id = "doc_plain123";
      const root = await StructuralParser.parsePlainText(doc_id, text, "Plain Text");

      expect(root.kind).toBe(NodeKind.DOCUMENT);
      expect(root.children.length).toBe(3);

      for (const child of root.children) {
        expect(child.kind).toBe(NodeKind.PARAGRAPH);
      }
      report("struct-parser: plain-text", s);
    });

    it("should handle single paragraph", async () => {
      const s = snap();
      const text = "Just one paragraph.";

      const doc_id = "doc_plain456";
      const root = await StructuralParser.parsePlainText(doc_id, text, "Single");

      expect(root.children.length).toBe(1);
      expect(root.children[0].kind).toBe(NodeKind.PARAGRAPH);
      expect(root.children[0].text).toBe(text);
      report("struct-parser: single-paragraph", s);
    });
  });

  describe("Auto-detect", () => {
    it("should auto-detect markdown", async () => {
      const s = snap();
      const markdown = "# Header\n\nParagraph.";
      const doc_id = "doc_auto123";

      const root = await StructuralParser.parse(doc_id, markdown, "Auto");

      // Should have detected markdown and created sections
      const hasSection = root.children.some((c) => c.kind === NodeKind.SECTION);
      expect(hasSection).toBe(true);
      report("struct-parser: auto-md", s);
    });

    it("should default to plain text when no markdown markers", async () => {
      const s = snap();
      const text = "Just plain text here.";
      const doc_id = "doc_auto456";

      const root = await StructuralParser.parse(doc_id, text, "Plain");

      // Should be plain paragraph
      expect(root.children[0].kind).toBe(NodeKind.PARAGRAPH);
      report("struct-parser: auto-plain", s);
    });
  });
});
