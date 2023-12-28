//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

export interface IDocument {
  title: string;
  content: string;
  nodes: IDocumentNode[];
}

export interface IDocumentNode {
  content: string;
  embeddings: IDocumentNodeEmbedding[];
}

export interface IDocumentNodeEmbedding {
  embedding: number[];
}

export type IDocumentList = IDocument[];
