//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Document, DocumentMetadata, TextFragment } from "./Document";
import { DocumentConverter } from "./DocumentConverter";

export class MasterDocument {
  public metadata: DocumentMetadata;
  public original: DocumentConverter;
  public master: Document;
  public variants: Document[] = [];
  constructor(original: DocumentConverter, metadata: DocumentMetadata) {
    this.metadata = Object.assign(original.metadata, metadata);
    this.original = original;
    this.master = original.convert();
    this.variants.push(paragraphVariant(this.master));
  }
}

function paragraphVariant(doc: Document): Document {
  const newdoc = new Document("", doc.metadata);
  for (const node of doc.fragments) {
    if (node instanceof TextFragment) {
      const newnodes = node.content
        .split("\n")
        .filter((t) => t)
        .map((paragraph) => new TextFragment(paragraph));
      newdoc.fragments.push(...newnodes);
    } else {
      newdoc.fragments.push(node);
    }
  }
  return newdoc;
}
