/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFnRegistration } from "@workglow/ai";
import {
  WEB_BROWSER_MODEL_INFO,
  WEB_BROWSER_MODEL_SEARCH,
  WEB_BROWSER_TEXT_GENERATION,
  WEB_BROWSER_TEXT_LANGUAGE_DETECTION,
  WEB_BROWSER_TEXT_REWRITER,
  WEB_BROWSER_TEXT_SUMMARY,
  WEB_BROWSER_TEXT_TRANSLATION,
} from "./WebBrowser_CapabilitySets";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

import { WebBrowser_ModelInfo } from "./WebBrowser_ModelInfo";
import { WebBrowser_ModelSearch } from "./WebBrowser_ModelSearch";
import { WebBrowser_TextGeneration } from "./WebBrowser_TextGeneration";
import { WebBrowser_TextLanguageDetection } from "./WebBrowser_TextLanguageDetection";
import { WebBrowser_TextRewriter } from "./WebBrowser_TextRewriter";
import { WebBrowser_TextSummary } from "./WebBrowser_TextSummary";
import { WebBrowser_TextTranslation } from "./WebBrowser_TextTranslation";

export const WEB_BROWSER_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  WebBrowserModelConfig
>[] = [
  { serves: WEB_BROWSER_TEXT_GENERATION, runFn: WebBrowser_TextGeneration },
  { serves: WEB_BROWSER_TEXT_REWRITER, runFn: WebBrowser_TextRewriter },
  { serves: WEB_BROWSER_TEXT_SUMMARY, runFn: WebBrowser_TextSummary },
  { serves: WEB_BROWSER_TEXT_TRANSLATION, runFn: WebBrowser_TextTranslation },
  { serves: WEB_BROWSER_TEXT_LANGUAGE_DETECTION, runFn: WebBrowser_TextLanguageDetection },
  { serves: WEB_BROWSER_MODEL_SEARCH, runFn: WebBrowser_ModelSearch },
  { serves: WEB_BROWSER_MODEL_INFO, runFn: WebBrowser_ModelInfo },
];
