/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import { WebBrowser_ModelSearch } from "./WebBrowser_ModelSearch";

import { WebBrowser_ModelInfo } from "./WebBrowser_ModelInfo";
import {
  WebBrowser_TextGeneration,
  WebBrowser_TextGeneration_Stream,
} from "./WebBrowser_TextGeneration";
import { WebBrowser_TextLanguageDetection } from "./WebBrowser_TextLanguageDetection";
import { WebBrowser_TextRewriter, WebBrowser_TextRewriter_Stream } from "./WebBrowser_TextRewriter";
import { WebBrowser_TextSummary, WebBrowser_TextSummary_Stream } from "./WebBrowser_TextSummary";
import {
  WebBrowser_TextTranslation,
  WebBrowser_TextTranslation_Stream,
} from "./WebBrowser_TextTranslation";

export const WEB_BROWSER_TASKS: Record<string, AiProviderRunFn<any, any, WebBrowserModelConfig>> = {
  ModelInfoTask: WebBrowser_ModelInfo,
  TextSummaryTask: WebBrowser_TextSummary,
  TextLanguageDetectionTask: WebBrowser_TextLanguageDetection,
  TextTranslationTask: WebBrowser_TextTranslation,
  TextGenerationTask: WebBrowser_TextGeneration,
  TextRewriterTask: WebBrowser_TextRewriter,
  ModelSearchTask: WebBrowser_ModelSearch,
};

export const WEB_BROWSER_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, WebBrowserModelConfig>
> = {
  TextSummaryTask: WebBrowser_TextSummary_Stream,
  TextTranslationTask: WebBrowser_TextTranslation_Stream,
  TextGenerationTask: WebBrowser_TextGeneration_Stream,
  TextRewriterTask: WebBrowser_TextRewriter_Stream,
};
