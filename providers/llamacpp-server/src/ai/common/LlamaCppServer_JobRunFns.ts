/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFnRegistration } from "@workglow/ai";
import {
  LLAMACPP_SERVER_MODEL_INFO,
  LLAMACPP_SERVER_MODEL_SEARCH,
  LLAMACPP_SERVER_TEXT_EMBEDDING,
  LLAMACPP_SERVER_TEXT_GENERATION,
  LLAMACPP_SERVER_TEXT_REWRITER,
  LLAMACPP_SERVER_TEXT_SUMMARY,
  LLAMACPP_SERVER_TOOL_USE,
} from "./LlamaCppServer_CapabilitySets";
import { type ILlamaCppServerProviderOptions } from "./LlamaCppServer_Client";
import { createLlamaCppServerModelInfoStream } from "./LlamaCppServer_ModelInfo";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";
import { createLlamaCppServerModelSearchStream } from "./LlamaCppServer_ModelSearch";
import { createLlamaCppServerTextEmbeddingStream } from "./LlamaCppServer_TextEmbedding";
import { createLlamaCppServerTextGenerationStream } from "./LlamaCppServer_TextGeneration";
import { createLlamaCppServerTextRewriterStream } from "./LlamaCppServer_TextRewriter";
import { createLlamaCppServerTextSummaryStream } from "./LlamaCppServer_TextSummary";
import { createLlamaCppServerToolCallingStream } from "./LlamaCppServer_ToolCalling";

/**
 * Build the full set of capability-set run-fn registrations bound to a
 * single set of provider options. Order is significant only as a
 * tiebreaker — the dispatcher prefers the smallest `serves` superset of
 * the task's `requires`.
 */
export function buildLlamaCppServerRunFns(
  opts: ILlamaCppServerProviderOptions
): readonly AiProviderRunFnRegistration<any, any, LlamaCppServerModelConfig>[] {
  return [
    {
      serves: LLAMACPP_SERVER_TEXT_GENERATION,
      runFn: createLlamaCppServerTextGenerationStream(opts),
    },
    { serves: LLAMACPP_SERVER_TOOL_USE, runFn: createLlamaCppServerToolCallingStream(opts) },
    { serves: LLAMACPP_SERVER_TEXT_REWRITER, runFn: createLlamaCppServerTextRewriterStream(opts) },
    { serves: LLAMACPP_SERVER_TEXT_SUMMARY, runFn: createLlamaCppServerTextSummaryStream(opts) },
    {
      serves: LLAMACPP_SERVER_TEXT_EMBEDDING,
      runFn: createLlamaCppServerTextEmbeddingStream(opts),
    },
    { serves: LLAMACPP_SERVER_MODEL_SEARCH, runFn: createLlamaCppServerModelSearchStream(opts) },
    { serves: LLAMACPP_SERVER_MODEL_INFO, runFn: createLlamaCppServerModelInfoStream(opts) },
  ];
}
