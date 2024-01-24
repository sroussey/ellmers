//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { pipeline, type PipelineType } from "@sroussey/transformers";
import { Model } from "#/Model";
import type { Instruct } from "#/Instruct";
import { NodeEmbedding, TextNode } from "#/Document";
import { ONNXTransformerJsModel } from "#/tasks/HuggingFaceLocalTasks";

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
  rewrittenText: string,
  model: Model,
  instruct: Instruct
) {
  const generateEmbedding = await getPipeline(model as ONNXTransformerJsModel);

  const text = rewrittenText || node.content;

  const output = await generateEmbedding(text, {
    pooling: "mean",
    normalize: model.normalize,
    temperature: instruct.parameters?.temperature,
  });

  const vector = Array.from<number>(output.data);

  if (vector.length !== model.dimensions) {
    throw new Error(
      `Embedding vector length does not match model dimensions v${vector.length} != m${model.dimensions}`
    );
  }

  node.embeddings.push(
    new NodeEmbedding(model.name, instruct.name, text, vector, model.normalize)
  );
}

export async function generateTransformerJsRewrite(
  node: TextNode,
  instruct: Instruct,
  query: boolean
): Promise<string> {
  let instruction = query
    ? instruct.queryInstruction
    : instruct.storageInstruction;
  if (!instruct.model) {
    return node.content;
  } else {
    instruction = instruction ? instruction + ":\n" : "";
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
      result = output?.[0]?.summary_text;
      break;
    default:
      throw new Error("rewrite model pipeline not supported yet");
  }

  return result;
}
