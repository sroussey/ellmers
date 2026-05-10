/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

export { loadOpenAISDK, getClient, getModelName } from "./OpenAI_Client";

import { OpenAI_CountTokens_Preview, OpenAI_CountTokens_Stream } from "./OpenAI_CountTokens";
import { OpenAI_ImageEdit_Stream } from "./OpenAI_ImageEdit";
import { OpenAI_ImageGenerate_Stream } from "./OpenAI_ImageGenerate";
import { OpenAI_ModelInfo_Stream } from "./OpenAI_ModelInfo";
import { OpenAI_ModelSearch_Stream } from "./OpenAI_ModelSearch";
import { OpenAI_StructuredGeneration_Stream } from "./OpenAI_StructuredGeneration";
import { OpenAI_TextEmbedding_Stream } from "./OpenAI_TextEmbedding";
import { OpenAI_TextGeneration_Stream } from "./OpenAI_TextGeneration";
import { OpenAI_TextRewriter_Stream } from "./OpenAI_TextRewriter";
import { OpenAI_TextSummary_Stream } from "./OpenAI_TextSummary";
import { OpenAI_ToolCalling_Stream } from "./OpenAI_ToolCalling";

/**
 * Capability-set run-fn registrations for the OpenAI provider. Order is
 * significant only as a tiebreaker — the dispatcher prefers the smallest
 * `serves` set that is a superset of the task's `requires`, so the bare
 * `["text.generation"]` entry wins for a plain {@link TextGenerationTask} or
 * {@link AiChatTask} while the `["text.generation", "tool-use"]` entry wins
 * for {@link ToolCallingTask}.
 */
export const OPENAI_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  OpenAiModelConfig
>[] = [
  { serves: ["text.generation"], runFn: OpenAI_TextGeneration_Stream },
  { serves: ["text.generation", "tool-use"], runFn: OpenAI_ToolCalling_Stream },
  { serves: ["text.generation", "json-mode"], runFn: OpenAI_StructuredGeneration_Stream },
  { serves: ["text.rewriter"], runFn: OpenAI_TextRewriter_Stream },
  { serves: ["text.summary"], runFn: OpenAI_TextSummary_Stream },
  { serves: ["text.embedding"], runFn: OpenAI_TextEmbedding_Stream },
  { serves: ["image.generation"], runFn: OpenAI_ImageGenerate_Stream },
  { serves: ["image.editing"], runFn: OpenAI_ImageEdit_Stream },
  { serves: ["model.count-tokens"], runFn: OpenAI_CountTokens_Stream },
  { serves: ["provider.model-search"], runFn: OpenAI_ModelSearch_Stream },
  { serves: ["provider.model-info"], runFn: OpenAI_ModelInfo_Stream },
];

export const OPENAI_PREVIEW_TASKS: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AiProviderPreviewRunFn<any, any, OpenAiModelConfig>
> = {
  CountTokensTask: OpenAI_CountTokens_Preview,
};
