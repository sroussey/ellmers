/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextClassificationPipeline } from "@huggingface/transformers";
import type { AiProviderRunFn, TextRerankerTaskInput, TextRerankerTaskOutput } from "@workglow/ai";
import { KbRerankerOutputError } from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Narrow guard: an entry from the text-classification pipeline must be an
 * object with a numeric `score`. We deliberately do not require `label`
 * to be present because some downstream models omit it; only `score` is
 * load-bearing for reranking.
 */
function isScored(v: unknown): v is { label?: string; score: number } {
  return (
    typeof v === "object" && v !== null && typeof (v as { score?: unknown }).score === "number"
  );
}

/**
 * Serialize an offending shape for the error payload. We cap the length to
 * keep error messages bounded — a misconfigured model could otherwise dump
 * unbounded data into logs.
 */
function truncateShape(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") return String(value);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(value);
  }
}

/**
 * Validate a transformers.js text-classification pipeline output and
 * extract per-document scores. Each entry must be either a `{ score }`
 * object or a non-empty array of such objects (transformers.js returns
 * the array form when `top_k > 1`).
 *
 * Exported so the shape contract can be exercised in tests directly,
 * without needing to spin up a real pipeline or mock the loader. Throws
 * {@link KbRerankerOutputError} on mismatch — silently coercing to 0
 * would hide real model config bugs.
 *
 * @param rawResults Whatever the pipeline call returned. Typed as
 *   `unknown` so the caller is forced through this validation.
 * @param modelPath Used in the error message to point operators at the
 *   misconfigured model.
 */
export function validateAndExtractRerankerScores(
  rawResults: unknown,
  modelPath: string | undefined
): number[] {
  if (!Array.isArray(rawResults)) {
    throw new KbRerankerOutputError(
      `HFT_TextReranker: unexpected pipeline output shape for model ${modelPath}`,
      truncateShape(rawResults)
    );
  }

  const scores: number[] = new Array(rawResults.length);
  for (let i = 0; i < rawResults.length; i++) {
    const entry = rawResults[i];
    const candidate = Array.isArray(entry) ? entry[0] : entry;
    if (!isScored(candidate)) {
      throw new KbRerankerOutputError(
        `HFT_TextReranker: unexpected pipeline output shape for model ${modelPath}`,
        truncateShape(entry)
      );
    }
    scores[i] = candidate.score;
  }
  return scores;
}

/**
 * Cross-encoder reranker run-fn. Loads a `text-classification` pipeline
 * (the way transformers.js exposes cross-encoder models like
 * `Xenova/bge-reranker-base`) and scores each `[query, doc]` pair.
 *
 * Output `indices` is sorted best-first; `scores` is the per-document score
 * in the original input order so callers can join back to their candidate
 * list without re-sorting.
 *
 * Each pipeline result entry is validated at runtime via
 * {@link validateAndExtractRerankerScores}: either a `{ score }` object or
 * a non-empty array of such objects. On mismatch we throw
 * {@link KbRerankerOutputError} with the model path and a truncated shape
 * snippet — silently coercing missing scores to 0 would hide real model
 * config bugs.
 */
export const HFT_TextReranker: AiProviderRunFn<
  TextRerankerTaskInput,
  TextRerankerTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const modelPath = model?.provider_config.model_path;
  const timerLabel = `hft:TextReranker:${modelPath}`;
  logger.time(timerLabel, { docs: input.documents.length });

  const reranker: TextClassificationPipeline = await getPipeline(model!, emit, {}, signal);

  // Transformers.js' text-classification pipeline accepts an array of
  // { text, text_pair } objects for sentence-pair tasks (which cross-encoder
  // rerankers are). The pipeline returns one score per input pair (or an
  // array of scored entries per pair when `top_k > 1`).
  const pairs = input.documents.map((doc) => ({ text: input.query, text_pair: doc }));

  // We cast the *input parameter* shape (transformers.js types the pipeline
  // very loosely) but keep the return as `Promise<unknown>` so the guard at
  // `validateAndExtractRerankerScores` is the only path to a typed score.
  // The original bug was casting the return to `Promise<Array<{ score }>>`,
  // which erased the safety net and let a mismatched pipeline silently
  // return garbage.
  const callable = reranker as unknown as (
    inputs: ReadonlyArray<{ text: string; text_pair: string }>,
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  const rawResults: unknown = await callable(pairs, { top_k: 1 });

  const scores = validateAndExtractRerankerScores(rawResults, modelPath);

  const indices = scores
    .map((score, idx) => ({ score, idx }))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.idx);

  const limited = typeof input.topK === "number" ? indices.slice(0, input.topK) : indices;

  logger.timeEnd(timerLabel, { docs: input.documents.length });
  emit({ type: "finish", data: { scores, indices: limited } });
};
