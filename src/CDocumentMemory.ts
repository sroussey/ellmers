//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { CDocument, CDocumentNode, CDocumentNodeEmbedding } from "./CDocument";

export class Document extends CDocument {
  constructor(title: string, content: string | string[]) {
    super(title, content);
    if (Array.isArray(content)) {
      for (const line of content) {
        this._nodes.push(new DocumentNode(line));
      }
    } else {
      this._nodes.push(new DocumentNode(content));
    }
  }
}

export class DocumentNode extends CDocumentNode {
  set embedding(embedding: number[]) {
    this._embeddings.push(new DocumentNodeEmbedding(embedding));
  }
}

export class DocumentNodeEmbedding extends CDocumentNodeEmbedding {}
