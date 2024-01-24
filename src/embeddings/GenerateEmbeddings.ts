//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ModelProcessorEnum } from "#/Model";
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
      let text = node.content;
      if (instruct.model) {
        switch (instruct.model.type) {
          case ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS:
            text = await generateTransformerJsRewrite(node, instruct, isQuery);
            break;
          default:
            throw new Error("Instruct Model type not supported yet");
        }
      }
      switch (embeddingModel.type) {
        case ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS:
          await generateTransformerJsEmbedding(
            node,
            text,
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
