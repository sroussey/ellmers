//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { ModelProcessorType, type ONNXTransformerJsModel } from "#/Model";
import { TextDocument } from "#/Document";
import type { StrategyList } from "#/Strategy";
import { generateTransformerJsEmbedding } from "./TransformerJsService";

export async function generateEmbeddings(
  strategies: StrategyList,
  document: TextDocument,
  isQuery: boolean
) {
  for (const node of document.nodes) {
    for (const { model, instruct } of strategies) {
      switch (model.type) {
        case ModelProcessorType.LOCAL_ONNX_TRANSFORMERJS:
          await generateTransformerJsEmbedding(
            node,
            model as ONNXTransformerJsModel,
            instruct,
            isQuery
          );
          break;
        default:
          throw new Error("Model type not supported yet");
      }
    }
  }
}

export async function generateDocumentEmbeddings(
  strategies: StrategyList,
  document: TextDocument
) {
  return generateEmbeddings(strategies, document, false);
}

export async function generateQueryEmbeddings(
  strategies: StrategyList,
  document: TextDocument
) {
  return generateEmbeddings(strategies, document, true);
}
