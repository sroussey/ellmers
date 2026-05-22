/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  WEB_BROWSER_MODEL_DISPOSE,
  WEB_BROWSER_MODEL_DOWNLOAD,
  WEB_BROWSER_MODEL_INFO,
  WEB_BROWSER_MODEL_SEARCH,
  WEB_BROWSER_TEXT_GENERATION,
  WEB_BROWSER_TEXT_LANGUAGE_DETECTION,
  WEB_BROWSER_TEXT_REWRITER,
  WEB_BROWSER_TEXT_SUMMARY,
  WEB_BROWSER_TEXT_TRANSLATION,
} from "./WebBrowser_CapabilitySets";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

import { WebBrowser_Chat } from "./WebBrowser_Chat";
import { WebBrowser_Download } from "./WebBrowser_Download";
import { WebBrowser_ModelDispose } from "./WebBrowser_ModelDispose";
import { WebBrowser_ModelInfo } from "./WebBrowser_ModelInfo";
import { WebBrowser_ModelSearch } from "./WebBrowser_ModelSearch";
import { WebBrowser_TextGeneration } from "./WebBrowser_TextGeneration";
import { WebBrowser_TextLanguageDetection } from "./WebBrowser_TextLanguageDetection";
import { WebBrowser_TextRewriter } from "./WebBrowser_TextRewriter";
import { WebBrowser_TextSummary } from "./WebBrowser_TextSummary";
import { WebBrowser_TextTranslation } from "./WebBrowser_TextTranslation";

const WebBrowser_TextGeneration_Unified: AiProviderRunFn<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  WebBrowserModelConfig
> = async (input, model, signal, emit, outputSchema, sessionId) => {
  const maybeMessages = (input as { messages?: unknown }).messages;
  if (Array.isArray(maybeMessages) && maybeMessages.length > 0) {
    await WebBrowser_Chat(input, model, signal, emit, outputSchema, sessionId);
  } else {
    await WebBrowser_TextGeneration(input, model, signal, emit, outputSchema, sessionId);
  }
};

export const WEB_BROWSER_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  WebBrowserModelConfig
>[] = [
  { serves: WEB_BROWSER_TEXT_GENERATION, runFn: WebBrowser_TextGeneration_Unified },
  { serves: WEB_BROWSER_TEXT_REWRITER, runFn: WebBrowser_TextRewriter },
  { serves: WEB_BROWSER_TEXT_SUMMARY, runFn: WebBrowser_TextSummary },
  { serves: WEB_BROWSER_TEXT_TRANSLATION, runFn: WebBrowser_TextTranslation },
  { serves: WEB_BROWSER_TEXT_LANGUAGE_DETECTION, runFn: WebBrowser_TextLanguageDetection },
  { serves: WEB_BROWSER_MODEL_SEARCH, runFn: WebBrowser_ModelSearch },
  { serves: WEB_BROWSER_MODEL_INFO, runFn: WebBrowser_ModelInfo },
  { serves: WEB_BROWSER_MODEL_DOWNLOAD, runFn: WebBrowser_Download },
  { serves: WEB_BROWSER_MODEL_DISPOSE, runFn: WebBrowser_ModelDispose },
];
