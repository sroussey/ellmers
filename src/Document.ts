//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

export abstract class Document {
  public nodes: Node[] = [];
}

export abstract class Node {
  constructor(public embeddings: NodeEmbedding[] = []) {}
}

export class NodeEmbedding {
  constructor(
    public modelName: string,
    public instructName: string,
    public embedding: number[]
  ) {}
}

export class TextNode extends Node {
  constructor(public content: string, embeddings: NodeEmbedding[] = []) {
    super(embeddings);
  }
}

export class TextDocument extends Document {
  constructor(public title: string, content?: string | string[]) {
    super();
    if (Array.isArray(content)) {
      for (const line of content) {
        this.nodes.push(new TextNode(line));
      }
    } else {
      if (content) this.nodes.push(new TextNode(content));
    }
  }
  public nodes: TextNode[] = [];
}
