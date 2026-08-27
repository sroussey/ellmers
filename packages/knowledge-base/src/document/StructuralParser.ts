/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type { DocumentRootNode, ParagraphNode, SectionNode } from "./DocumentSchema";
import { NodeKind } from "./DocumentSchema";

export class StructuralParser {
  /**
   * Parse markdown text into a hierarchical document tree. Offsets are measured
   * in UTF-16 code units (consistent with `String.prototype.length` and
   * `String.prototype.slice()`).
   */
  static async parseMarkdown(
    _doc_id: string,
    text: string,
    title: string
  ): Promise<DocumentRootNode> {
    const lines = text.split("\n");
    let currentOffset = 0;

    const root: DocumentRootNode = {
      nodeId: uuid4(),
      kind: NodeKind.DOCUMENT,
      range: { startOffset: 0, endOffset: text.length },
      text: title,
      title,
      children: [],
    };

    let currentParentStack: Array<DocumentRootNode | SectionNode> = [root];
    let textBuffer: string[] = [];
    let textBufferStartOffset = 0;

    const flushTextBuffer = async () => {
      if (textBuffer.length > 0) {
        const content = textBuffer.join("\n").trim();
        if (content) {
          const paragraphStartOffset = textBufferStartOffset;
          const paragraphEndOffset = currentOffset;

          const paragraph: ParagraphNode = {
            nodeId: uuid4(),
            kind: NodeKind.PARAGRAPH,
            range: {
              startOffset: paragraphStartOffset,
              endOffset: paragraphEndOffset,
            },
            text: content,
          };

          currentParentStack[currentParentStack.length - 1].children.push(paragraph);
        }
        textBuffer = [];
      }
    };

    for (const line of lines) {
      const lineLength = line.length + 1; // +1 for newline.

      const headerMatch = line.match(/^(#{1,6}) ([^\n]+)$/);
      if (headerMatch) {
        await flushTextBuffer();

        const level = headerMatch[1].length;
        const headerTitle = headerMatch[2];

        // Pop sections until we find the right parent; close their ranges at
        // the start of the new header (not text.length).
        while (
          currentParentStack.length > 1 &&
          currentParentStack[currentParentStack.length - 1].kind === NodeKind.SECTION &&
          (currentParentStack[currentParentStack.length - 1] as SectionNode).level >= level
        ) {
          const poppedSection = currentParentStack.pop() as SectionNode;
          const updatedSection: SectionNode = {
            ...poppedSection,
            range: {
              ...poppedSection.range,
              endOffset: currentOffset,
            },
          };
          const parent = currentParentStack[currentParentStack.length - 1];
          parent.children[parent.children.length - 1] = updatedSection;
        }

        const sectionStartOffset = currentOffset;
        const section: SectionNode = {
          nodeId: uuid4(),
          kind: NodeKind.SECTION,
          level,
          title: headerTitle,
          range: {
            startOffset: sectionStartOffset,
            // Patched to the real endOffset when popped or at end-of-parse.
            endOffset: text.length,
          },
          text: headerTitle,
          children: [],
        };

        currentParentStack[currentParentStack.length - 1].children.push(section);
        currentParentStack.push(section);
      } else {
        if (textBuffer.length === 0) {
          textBufferStartOffset = currentOffset;
        }
        textBuffer.push(line);
      }

      currentOffset += lineLength;
    }

    await flushTextBuffer();

    // Close any remaining sections at end-of-document.
    while (currentParentStack.length > 1) {
      const section = currentParentStack.pop() as SectionNode;
      const updatedSection: SectionNode = {
        ...section,
        range: {
          ...section.range,
          endOffset: text.length,
        },
      };
      const parent = currentParentStack[currentParentStack.length - 1];
      parent.children[parent.children.length - 1] = updatedSection;
    }

    return root;
  }

  /** Splits by blank lines to produce paragraph nodes. */
  static async parsePlainText(
    _doc_id: string,
    text: string,
    title: string
  ): Promise<DocumentRootNode> {
    const root: DocumentRootNode = {
      nodeId: uuid4(),
      kind: NodeKind.DOCUMENT,
      range: { startOffset: 0, endOffset: text.length },
      text: title,
      title,
      children: [],
    };

    const paragraphRegex = /\n\s*\n/g;
    let lastIndex = 0;
    let paragraphIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = paragraphRegex.exec(text)) !== null) {
      const rawParagraph = text.slice(lastIndex, match.index);
      const paragraphText = rawParagraph.trim();

      if (paragraphText.length > 0) {
        const trimmedRelativeStart = rawParagraph.indexOf(paragraphText);
        const startOffset = lastIndex + trimmedRelativeStart;
        const endOffset = startOffset + paragraphText.length;

        const paragraph: ParagraphNode = {
          nodeId: uuid4(),
          kind: NodeKind.PARAGRAPH,
          range: {
            startOffset,
            endOffset,
          },
          text: paragraphText,
        };

        root.children.push(paragraph);
        paragraphIndex++;
      }

      lastIndex = paragraphRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      const rawParagraph = text.slice(lastIndex);
      const paragraphText = rawParagraph.trim();

      if (paragraphText.length > 0) {
        const trimmedRelativeStart = rawParagraph.indexOf(paragraphText);
        const startOffset = lastIndex + trimmedRelativeStart;
        const endOffset = startOffset + paragraphText.length;

        const paragraph: ParagraphNode = {
          nodeId: uuid4(),
          kind: NodeKind.PARAGRAPH,
          range: {
            startOffset,
            endOffset,
          },
          text: paragraphText,
        };

        root.children.push(paragraph);
      }
    }
    return root;
  }

  static parse(
    doc_id: string,
    text: string,
    title: string,
    format?: "markdown" | "text"
  ): Promise<DocumentRootNode> {
    if (format === "markdown" || (!format && this.looksLikeMarkdown(text))) {
      return this.parseMarkdown(doc_id, text, title);
    }
    return this.parsePlainText(doc_id, text, title);
  }

  private static looksLikeMarkdown(text: string): boolean {
    return /^#{1,6}\s/m.test(text);
  }
}
