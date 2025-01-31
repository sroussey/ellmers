//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Document, DocumentMetadata } from "./Document";
import { DocumentConverter } from "./DocumentConverter";

export class DocumentConverterText extends DocumentConverter {
  constructor(
    metadata: DocumentMetadata,
    public text: string
  ) {
    super(metadata);
  }
  public convert(): Document {
    return new Document(this.text, this.metadata);
  }
}
