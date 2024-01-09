//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { pipeline, type PipelineType } from "@sroussey/transformers";
import { Model, type ONNXTransformerJsModel } from "#/Model";
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
  model: Model,
  instruct: Instruct
) {
  const generateEmbedding = await getPipeline(model as ONNXTransformerJsModel);

  const output = await generateEmbedding(node.content, {
    pooling: "mean",
    normalize: true,
    temperature: instruct.parameters?.temperature,
  });

  const vector = Array.from<number>(output.data);

  if (vector.length !== model.dimensions) {
    throw new Error(
      `Embedding vector length does not match model dimensions v${vector.length} != m${model.dimensions}`
    );
  }

  node.embeddings.push(new NodeEmbedding(model.name, instruct.name, vector));
}

export async function generateTransformerJsRewrite(
  node: TextNode,
  instruct: Instruct,
  query: boolean
) {
  let instruction = query
    ? instruct.queryInstruction
    : instruct.storageInstruction;
  if (!instruct.model) {
    return node;
  } else {
    instruction = instruction + ":\n";
  }

  const rewriter = await getPipeline(instruct.model as ONNXTransformerJsModel);

  const output = await rewriter(node.content);
  let result = "";

  switch ((instruct.model as ONNXTransformerJsModel).pipeline) {
    case "text-generation":
      result = output.generated_text;
      break;
    case "zero-shot-classification":
      result = output.labels.join(", ");
      break;
    case "question-answering":
      result = output.answer;
      break;
    case "summarization":
      result = output.summary_text;
      break;
    default:
      throw new Error("rewrite model pipeline not supported yet");
  }

  // the runtime type may be a subclass
  const constructor = node.constructor as typeof TextNode;
  return new constructor(result, []);
}
