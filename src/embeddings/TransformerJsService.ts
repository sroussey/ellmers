//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { pipeline, PipelineType } from "@sroussey/transformers";
import type { Model } from "#/Model";
import type { Instruct } from "#/Instruct";
import { NodeEmbedding, TextDocument, TextNode } from "#/Document";
import { StrategyList } from "#/Strategy";

const modelPipelines: Record<string, any> = {};

export const getPipeline = async (
  model: Model,
  progress_callback?: (progress: any) => void
) => {
  if (!modelPipelines[model.name]) {
    modelPipelines[model.name] = await pipeline(
      model.pipeline as PipelineType,
      model.name,
      {
        progress_callback,
      }
    );
  }
  return modelPipelines[model.name];
};

export class TransformerJsService {
  constructor(private strategies: StrategyList) {}
  async generateDocumentEmbeddings(document: TextDocument, query = false) {
    for (const node of document.nodes) {
      for (const { model, instruct } of this.strategies) {
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

    const vector = Array.from<number>(output.data);

    if (vector.length !== model.dimensions) {
      throw new Error(
        "Embedding vector length does not match model dimensions"
      );
    }

    node.embeddings.push(new NodeEmbedding(model.name, instruct.name, vector));
  }
}
