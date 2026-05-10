/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  AiProviderStreamFn,
} from "@workglow/ai";
import type { StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  WEB_BROWSER_MODEL_INFO,
  WEB_BROWSER_MODEL_SEARCH,
  WEB_BROWSER_TEXT_GENERATION,
  WEB_BROWSER_TEXT_LANGUAGE_DETECTION,
  WEB_BROWSER_TEXT_REWRITER,
  WEB_BROWSER_TEXT_SUMMARY,
  WEB_BROWSER_TEXT_TRANSLATION,
} from "./WebBrowser_CapabilitySets";

import { WebBrowser_ModelInfo } from "./WebBrowser_ModelInfo";
import { WebBrowser_ModelSearch } from "./WebBrowser_ModelSearch";
import { WebBrowser_TextGeneration_Stream } from "./WebBrowser_TextGeneration";
import { WebBrowser_TextLanguageDetection } from "./WebBrowser_TextLanguageDetection";
import { WebBrowser_TextRewriter_Stream } from "./WebBrowser_TextRewriter";
import { WebBrowser_TextSummary_Stream } from "./WebBrowser_TextSummary";
import { WebBrowser_TextTranslation_Stream } from "./WebBrowser_TextTranslation";

function asStreamFn<
  I extends TaskInput = TaskInput,
  O extends TaskOutput = TaskOutput,
  M extends WebBrowserModelConfig = WebBrowserModelConfig,
>(fn: AiProviderRunFn<I, O, M>): AiProviderStreamFn<I, O, M> {
  return async function* (
    input,
    model,
    signal,
    outputSchema,
    sessionId
  ): AsyncIterable<StreamEvent<O>> {
    const noopProgress = (): void => {};
    const data = await fn(input, model, noopProgress, signal, outputSchema, sessionId);
    yield { type: "finish", data };
  };
}

export const WEB_BROWSER_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  WebBrowserModelConfig
>[] = [
  { serves: WEB_BROWSER_TEXT_GENERATION, runFn: WebBrowser_TextGeneration_Stream },
  { serves: WEB_BROWSER_TEXT_REWRITER, runFn: WebBrowser_TextRewriter_Stream },
  { serves: WEB_BROWSER_TEXT_SUMMARY, runFn: WebBrowser_TextSummary_Stream },
  { serves: WEB_BROWSER_TEXT_TRANSLATION, runFn: WebBrowser_TextTranslation_Stream },
  {
    serves: WEB_BROWSER_TEXT_LANGUAGE_DETECTION,
    runFn: asStreamFn(WebBrowser_TextLanguageDetection),
  },
  { serves: WEB_BROWSER_MODEL_SEARCH, runFn: asStreamFn(WebBrowser_ModelSearch) },
  { serves: WEB_BROWSER_MODEL_INFO, runFn: asStreamFn(WebBrowser_ModelInfo) },
];
