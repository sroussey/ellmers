//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Document, type DocumentMetadata, type DocumentSection } from "./Document";
import { DocumentConverter } from "./DocumentConverter";

export class DocumentConverterMarkdown extends DocumentConverter {
  constructor(
    metadata: DocumentMetadata,
    public markdown: string
  ) {
    super(metadata);
  }
  public convert(): Document {
    const parser = new MarkdownParser(this.metadata.title);
    const document = parser.parse(this.markdown);
    return document;
  }
}

class MarkdownParser {
  private document: Document;
  private currentSection: Document | DocumentSection;
  private textBuffer: string[] = []; // Buffer to accumulate text lines

  constructor(title: string) {
    this.document = new Document(title);
    this.currentSection = this.document;
  }

  parse(markdown: string): Document {
    const lines = markdown.split("\n");

    lines.forEach((line, index) => {
      if (this.isHeader(line)) {
        this.flushTextBuffer();
        const { level, content } = this.parseHeader(line);
        this.currentSection =
          level === 1 ? this.document.addSection(content) : this.currentSection.addSection(content);
      } else if (this.isTableStart(line)) {
        this.flushTextBuffer();
        const tableLines = this.collectTableLines(lines, index);
        this.currentSection.addTable(tableLines.join("\n"));
      } else if (this.isImageInline(line)) {
        this.parseLineWithPossibleImages(line);
      } else {
        this.textBuffer.push(line); // Accumulate text lines in the buffer
      }
    });

    this.flushTextBuffer(); // Flush any remaining text in the buffer
    return this.document;
  }

  private flushTextBuffer() {
    if (this.textBuffer.length > 0) {
      const textContent = this.textBuffer.join("\n").trim();
      if (textContent) {
        this.currentSection.addText(textContent);
      }
      this.textBuffer = []; // Clear the buffer after flushing
    }
  }

  private parseLineWithPossibleImages(line: string) {
    // Split the line by image markdown, keeping the delimiter (image markdown)
    const parts = line.split(/(!\[.*?\]\(.*?\))/).filter((part) => part !== "");
    parts.forEach((part) => {
      if (this.isImage(part)) {
        const { alt, src } = this.parseImage(part);
        this.flushTextBuffer();
        this.currentSection.addImage({ alt, src });
      } else {
        this.textBuffer.push(part);
      }
    });
    this.flushTextBuffer();
  }

  private isHeader(line: string): boolean {
    return /^#{1,6}\s/.test(line);
  }

  private parseHeader(line: string): { level: number; content: string } {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    return match ? { level: match[1].length, content: match[2] } : { level: 0, content: "" };
  }

  private isTableStart(line: string): boolean {
    return line.trim().startsWith("|") && line.includes("|", line.indexOf("|") + 1);
  }

  private collectTableLines(lines: string[], startIndex: number): string[] {
    const tableLines = [];
    for (let i = startIndex; i < lines.length && this.isTableLine(lines[i]); i++) {
      tableLines.push(lines[i]);
    }
    return tableLines;
  }

  private isTableLine(line: string): boolean {
    return line.includes("|");
  }

  private isImageInline(line: string): boolean {
    return line.includes("![") && line.includes("](");
  }

  private isImage(part: string): boolean {
    return /^!\[.*\]\(.*\)$/.test(part);
  }

  private parseImage(markdown: string): { alt: string; src: string } {
    const match = markdown.match(/^!\[(.*)\]\((.*)\)$/);
    return match ? { alt: match[1], src: match[2] } : { alt: "", src: "" };
  }
}
