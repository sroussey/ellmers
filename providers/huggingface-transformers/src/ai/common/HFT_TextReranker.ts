/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextClassificationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextRerankerTaskInput,
  TextRerankerTaskOutput,
} from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Cross-encoder reranker run-fn. Loads a `text-classification` pipeline
 * (the way transformers.js exposes cross-encoder models like
 * `Xenova/bge-reranker-base`) and scores each `[query, doc]` pair.
 *
 * Output `indices` is sorted best-first; `scores` is the per-document score
 * in the original input order so callers can join back to their candidate
 * list without re-sorting.
 */
export const HFT_TextReranker: AiProviderRunFn<
  TextRerankerTaskInput,
  TextRerankerTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:TextReranker:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { docs: input.documents.length });

  const reranker: TextClassificationPipeline = await getPipeline(model!, onProgress, {}, signal);

  // Transformers.js' text-classification pipeline accepts an array of
  // { text, text_pair } objects for sentence-pair tasks (which cross-encoder
  // rerankers are). The pipeline returns one score per input pair.
  const pairs = input.documents.map((doc) => ({ text: input.query, text_pair: doc }));
  const rawResults = (await (reranker as unknown as (
    inputs: Array<{ text: string; text_pair: string }>,
    options?: Record<string, unknown>
  ) => Promise<Array<{ label: string; score: number } | Array<{ label: string; score: number }>>>)(
    pairs,
    { top_k: 1 }
  )) as Array<{ label: string; score: number } | Array<{ label: string; score: number }>>;

  const scores: number[] = rawResults.map((r) => {
    if (Array.isArray(r)) {
      // top_k > 1 returns array per input — take the best
      return r[0]?.score ?? 0;
    }
    return r.score;
  });

  const indices = scores
    .map((score, idx) => ({ score, idx }))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.idx);

  const limited = typeof input.topK === "number" ? indices.slice(0, input.topK) : indices;

  logger.timeEnd(timerLabel, { docs: input.documents.length });
  return { scores, indices: limited };
};
