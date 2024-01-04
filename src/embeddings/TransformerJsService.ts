//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { pipeline, type PipelineType } from "@sroussey/transformers";
import { type ONNXTransformerJsModel } from "#/Model";
import type { Instruct } from "#/Instruct";
import { NodeEmbedding, TextNode } from "#/Document";

const modelPipelinesCache: Record<string, any> = {};

export const getPipeline = async (
  model: ONNXTransformerJsModel,
  progress_callback?: (progress: any) => void
) => {
  if (!modelPipelinesCache[model.name]) {
    modelPipelinesCache[model.name] = await pipeline(
      model.pipeline as PipelineType,
      model.name,
      {
        progress_callback,
      }
    );
  }
  return modelPipelinesCache[model.name];
};

export async function generateTransformerJsEmbedding(
  node: TextNode,
  model: ONNXTransformerJsModel,
  instruct: Instruct,
  query: boolean
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
      `Embedding vector length does not match model dimensions v${vector.length} != m${model.dimensions}`
    );
  }

  node.embeddings.push(new NodeEmbedding(model.name, instruct.name, vector));
}
