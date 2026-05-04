/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
} from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { WEB_BROWSER } from "./common/WebBrowser_Constants";
import type { WebBrowserModelConfig } from "./common/WebBrowser_ModelSchema";

/**
 * AI provider for Chrome Built-in AI APIs (Gemini Nano on-device).
 *
 * Browser-only provider — no external SDK needed, the APIs are browser globals.
 *
 * Supports summarization, language detection, translation, text generation
 * (Prompt API), and text rewriting via Chrome's Built-in AI APIs.
 *
 * Task run functions are injected via the constructor so that the provider
 * class itself has no runtime dependency on Chrome globals (it can be
 * instantiated on the main thread in worker mode without errors).
 */
export class WebBrowserProvider extends AiProvider<WebBrowserModelConfig> {
  readonly name = WEB_BROWSER;
  readonly displayName = "Chrome Built-in AI";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "ModelInfoTask",
    "TextSummaryTask",
    "TextLanguageDetectionTask",
    "TextTranslationTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, WebBrowserModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, WebBrowserModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, WebBrowserModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}
