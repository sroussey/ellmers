//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { NodeEmbedding, QueryText, TextNode } from "#/Document";

// TODO: use simsind to speed up similarity calculations

export function dot(arr1: number[], arr2: number[]) {
  return arr1.reduce((acc, val, i) => acc + val * arr2[i], 0);
}

export function magnitude(arr: number[]) {
  return Math.sqrt(arr.reduce((acc, val) => acc + val * val, 0));
}

function cos_sim(arr1: number[], arr2: number[]) {
  const dotProduct = dot(arr1, arr2);
  const magnitude1 = magnitude(arr1);
  const magnitude2 = magnitude(arr2);
  return dotProduct / (magnitude1 * magnitude2);
}

export function similarity(
  node1embedding: NodeEmbedding,
  node2embedding: NodeEmbedding
): number {
  if (node1embedding.vector.length !== node2embedding.vector.length) {
    throw new Error("Embeddings lengths don't match");
  }
  if (node1embedding.normalized !== node2embedding.normalized) {
    throw new Error("Embeddings normalized status don't match");
  }
  if (node1embedding.normalized) {
    return dot(node1embedding.vector, node2embedding.vector);
  } else {
    return cos_sim(node1embedding.vector, node2embedding.vector);
  }
}

export function getTopKEmbeddings(
  query: QueryText,
  nodes: TextNode[],
  k: number = 3
) {
  let similarities: {
    similarity: number;
    node: TextNode;
    embedding: NodeEmbedding;
  }[] = [];

  for (const queryEmbedding of query.embeddings) {
    // for each query strategy embedding

    for (const node of nodes) {
      // for each node find the same strategy embedding as query
      const nodeEmbedding = node.embeddings.find(
        (ne) =>
          ne.modelName === queryEmbedding.modelName &&
          ne.instructName === queryEmbedding.instructName
      );

      if (!nodeEmbedding) {
        throw new Error(
          `Node does not have the same embedding as query: queryEmbedding.modelName: ${queryEmbedding.modelName} queryEmbedding.instructName: ${queryEmbedding.instructName}`
        );
      }

      // for each node embedding
      const sim = similarity(queryEmbedding, nodeEmbedding);
      similarities.push({
        similarity: sim,
        node: node,
        embedding: nodeEmbedding,
      });
    }
  }

  similarities.sort((a, b) => b.similarity - a.similarity); // Reverse sort

  return similarities.slice(0, k);
}
