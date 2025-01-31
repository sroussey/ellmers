//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

enum DocumentType {
  DOCUMENT = "document",
  SECTION = "section",
  TEXT = "text",
  IMAGE = "image",
  TABLE = "table",
}

const doc_variants = [
  "tree",
  "flat",
  "tree-paragraphs",
  "flat-paragraphs",
  "tree-sentences",
  "flat-sentences",
] as const;
type DocVariant = (typeof doc_variants)[number];
const doc_parsers = ["txt", "md"] as const; // | "html" | "pdf" | "csv";
type DocParser = (typeof doc_parsers)[number];

export interface DocumentMetadata {
  title: string;
}

export interface DocumentSectionMetadata {
  title: string;
}

/**
 * Represents a document with its content and metadata.
 */
export class Document {
  public metadata: DocumentMetadata;

  constructor(content?: ContentType, metadata: DocumentMetadata = { title: "" }) {
    this.metadata = metadata;
    if (content) {
      if (Array.isArray(content)) {
        for (const line of content) {
          this.addContent(line);
        }
      } else {
        this.addContent(content);
      }
    }
  }

  public addContent(content: ContentTypeItem) {
    if (typeof content === "string") {
      this.addText(content);
    } else if (content instanceof DocumentBaseFragment || content instanceof DocumentSection) {
      this.fragments.push(content);
    } else {
      throw new Error("Unknown content type");
    }
  }

  public addSection(content?: ContentType, metadata?: DocumentSectionMetadata): DocumentSection {
    const section = new DocumentSection(this, content, metadata);
    this.fragments.push(section);
    return section;
  }

  public addText(content: string): TextFragment {
    const f = new TextFragment(content);
    this.fragments.push(f);
    return f;
  }
  public addImage(content: unknown): ImageFragment {
    const f = new ImageFragment(content);
    this.fragments.push(f);
    return f;
  }
  public addTable(content: unknown): TableFragment {
    const f = new TableFragment(content);
    this.fragments.push(f);
    return f;
  }

  public fragments: Array<DocumentFragment | DocumentSection> = [];

  toJSON(): unknown {
    return {
      type: DocumentType.DOCUMENT,
      metadata: this.metadata,
      fragments: this.fragments.map((f) => f.toJSON()),
    };
  }
}

export class DocumentSection extends Document {
  constructor(
    public parent: Document,
    content?: ContentType,
    metadata?: DocumentSectionMetadata
  ) {
    super(content, metadata);
    this.parent = parent;
  }

  toJSON(): unknown {
    return {
      type: DocumentType.SECTION,
      metadata: this.metadata,
      fragments: this.fragments.map((f) => f.toJSON()),
    };
  }
}

interface DocumentFragmentMetadata {}

export class DocumentBaseFragment {
  metadata?: DocumentFragmentMetadata;
  constructor(metadata?: DocumentFragmentMetadata) {
    this.metadata = metadata;
  }
}

export class TextFragment extends DocumentBaseFragment {
  content: string;
  constructor(content: string, metadata?: DocumentFragmentMetadata) {
    super(metadata);
    this.content = content;
  }
  toJSON(): unknown {
    return {
      type: DocumentType.TEXT,
      metadata: this.metadata,
      content: this.content,
    };
  }
}

export class TableFragment extends DocumentBaseFragment {
  content: any;
  constructor(content: any, metadata?: DocumentFragmentMetadata) {
    super(metadata);
    this.content = content;
  }
  toJSON(): unknown {
    return {
      type: DocumentType.TABLE,
      metadata: this.metadata,
      content: this.content,
    };
  }
}

export class ImageFragment extends DocumentBaseFragment {
  content: any;
  constructor(content: any, metadata?: DocumentFragmentMetadata) {
    super(metadata);
    this.content = content;
  }
  toJSON(): unknown {
    return {
      type: DocumentType.IMAGE,
      metadata: this.metadata,
      content: this.content,
    };
  }
}

export type DocumentFragment = TextFragment | TableFragment | ImageFragment;

export type ContentTypeItem = string | DocumentFragment | DocumentSection;
export type ContentType = ContentTypeItem | ContentTypeItem[];
