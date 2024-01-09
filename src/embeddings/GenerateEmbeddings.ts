//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { ModelProcessorType } from "#/Model";
import { TextDocument } from "#/Document";
import type { StrategyList } from "#/Strategy";
import {
  generateTransformerJsEmbedding,
  generateTransformerJsRewrite,
} from "./TransformerJsService";

export async function generateEmbeddings(
  strategies: StrategyList,
  document: TextDocument,
  isQuery: boolean
) {
  for (const node of document.nodes) {
    for (const { embeddingModel, instruct } of strategies) {
      let currentNode = node;
      if (instruct.model) {
        switch (instruct.model.type) {
          case ModelProcessorType.LOCAL_ONNX_TRANSFORMERJS:
            currentNode = await generateTransformerJsRewrite(
              node,
              instruct,
              isQuery
            );
            break;
          default:
            throw new Error("Instruct Model type not supported yet");
        }
      }
      switch (embeddingModel.type) {
        case ModelProcessorType.LOCAL_ONNX_TRANSFORMERJS:
          await generateTransformerJsEmbedding(
            currentNode.content ? currentNode : node,
            embeddingModel,
            instruct
          );
          break;
        default:
          throw new Error("Embedding Model type not supported yet");
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
