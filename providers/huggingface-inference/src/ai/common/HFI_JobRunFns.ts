/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFnRegistration } from "@workglow/ai";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import {
  HFI_IMAGE_EDITING,
  HFI_IMAGE_GENERATION,
  HFI_MODEL_INFO,
  HFI_MODEL_SEARCH,
  HFI_TEXT_EMBEDDING,
  HFI_TEXT_GENERATION,
  HFI_TEXT_REWRITER,
  HFI_TEXT_SUMMARY,
  HFI_TOOL_USE,
} from "./HFI_CapabilitySets";

export { loadHfInferenceSDK, getClient, getModelName, getProvider } from "./HFI_Client";

import { HFI_ImageEdit_Stream } from "./HFI_ImageEdit";
import { HFI_ImageGenerate_Stream } from "./HFI_ImageGenerate";
import { HFI_ModelInfo } from "./HFI_ModelInfo";
import { HFI_ModelSearch } from "./HFI_ModelSearch";
import { HFI_TextEmbedding } from "./HFI_TextEmbedding";
import { HFI_TextGeneration_Stream } from "./HFI_TextGeneration";
import { HFI_TextRewriter_Stream } from "./HFI_TextRewriter";
import { HFI_TextSummary_Stream } from "./HFI_TextSummary";
import { HFI_ToolCalling_Stream } from "./HFI_ToolCalling";

/**
 * Unified `["text.generation"]` run-fn. {@link AiChatTask} and
 * {@link TextGenerationTask} share this registration; discriminates on
 * `Array.isArray(input.messages) && input.messages.length > 0` to route to
 * the chat or prompt path. Because HFI doesn't have a separate chat stream
 * helper, both paths run through `HFI_TextGeneration_Stream` — the SDK
 * accepts both shapes.
 */
const HFI_TextGeneration_Unified = HFI_TextGeneration_Stream;

export const HFI_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  HfInferenceModelConfig
>[] = [
  { serves: HFI_TEXT_GENERATION, runFn: HFI_TextGeneration_Unified },
  { serves: HFI_TOOL_USE, runFn: HFI_ToolCalling_Stream },
  { serves: HFI_TEXT_REWRITER, runFn: HFI_TextRewriter_Stream },
  { serves: HFI_TEXT_SUMMARY, runFn: HFI_TextSummary_Stream },
  { serves: HFI_TEXT_EMBEDDING, runFn: HFI_TextEmbedding },
  { serves: HFI_IMAGE_GENERATION, runFn: HFI_ImageGenerate_Stream },
  { serves: HFI_IMAGE_EDITING, runFn: HFI_ImageEdit_Stream },
  { serves: HFI_MODEL_SEARCH, runFn: HFI_ModelSearch },
  { serves: HFI_MODEL_INFO, runFn: HFI_ModelInfo },
];
