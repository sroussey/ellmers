//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Pipeline, pipeline } from "@sroussey/transformers";
import { Model, ModelList } from "./Model";
import { Instruct, InstructList } from "./Instruct";
import { NodeEmbedding, TextDocument, TextNode } from "./Document";
import assert from "assert";

const modelPipelines: Record<string, Pipeline> = {};

const getPipeline = async (model: Model) => {
  if (!modelPipelines[model.name]) {
    modelPipelines[model.name] = await pipeline("embeddings", model.name, {
      progress_callback: (progress: number) => {
        console.log(`Progress:`, { progress });
      },
    });
  }
  return modelPipelines[model.name];
};

export class TransformerJsService {
  constructor(
    private modelList: ModelList,
    private instructList: InstructList
  ) {}
  async generateDocumentEmbeddings(document: TextDocument, query = false) {
    for (const node of document.nodes) {
      for (const model of this.modelList) {
        for (const instruct of this.instructList)
          await this.generateEmbedding(node, model, instruct, query);
      }
    }
  }
  async generateEmbedding(
    node: TextNode,
    model: Model,
    instruct: Instruct,
    query = false
  ) {
    const generateEmbedding = await getPipeline(model);

    const output = await generateEmbedding(
      (query ? instruct.queryInstruction : instruct.storageInstruction) +
        node.content,
      {
        pooling: "mean",
        normalize: true,
        temperature: instruct.parameters?.temperature,
      }
    );

    const embedding = Array.from<number>(output.data);
    assert(
      embedding.length === model.dimensions,
      "Embedding length does not match model dimensions"
    );

    node.embeddings.push(
      new NodeEmbedding(model.name, instruct.name, embedding)
    );
  }
}
