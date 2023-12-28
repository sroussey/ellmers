//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { IDocument, IDocumentNode, IDocumentNodeEmbedding } from "./IDocument";

export class CDocument implements IDocument {
  constructor(public title: string, content: string | string[]) {
    if (Array.isArray(content)) {
      this._content = content.join("\n");
    } else {
      this._content = content;
    }
  }

  protected _content: string;
  get content() {
    return this._content;
  }

  protected _nodes: CDocumentNode[] = [];
  get nodes(): IDocumentNode[] {
    return this._nodes;
  }
}

export class CDocumentNode implements IDocumentNode {
  constructor(public content: string) {}

  protected _embeddings: CDocumentNodeEmbedding[] = [];
  get embeddings(): CDocumentNodeEmbedding[] {
    return this._embeddings;
  }
}

export class CDocumentNodeEmbedding implements IDocumentNodeEmbedding {
  constructor(public embedding: number[]) {}
}
