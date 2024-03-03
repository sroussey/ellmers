//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Document, DocumentMetadata } from "./Document";

export abstract class DocumentConverter {
  public metadata: DocumentMetadata;
  constructor(metadata: DocumentMetadata) {
    this.metadata = metadata;
  }
  public abstract convert(): Document;
}
