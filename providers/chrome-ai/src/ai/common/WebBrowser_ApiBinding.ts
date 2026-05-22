/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

function getApi<T>(name: string, global: T | undefined): T {
  if (!global) {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" API is not available in this browser.`
    );
  }
  return global;
}

/** Default language pair for Translator availability when the task has no langs yet. */
const DEFAULT_TRANSLATOR_LANGS = { sourceLanguage: "en", targetLanguage: "es" } as const;

/**
 * Chrome requires the same options for `availability()` as for `create()` / `prompt()`.
 * @see https://developer.chrome.com/docs/ai/prompt-api
 */
export const LANGUAGE_MODEL_AVAILABILITY_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
} as const satisfies LanguageModelCreateCoreOptions;

export type WebBrowserApiBinding =
  | {
      apiName: "Summarizer";
      factory: typeof Summarizer;
      availabilityOptions?: SummarizerCreateCoreOptions;
      createOptions?: SummarizerCreateCoreOptions;
    }
  | {
      apiName: "Rewriter";
      factory: typeof Rewriter;
      availabilityOptions?: RewriterCreateCoreOptions;
      createOptions?: RewriterCreateCoreOptions;
    }
  | {
      apiName: "Translator";
      factory: typeof Translator;
      availabilityOptions: TranslatorCreateCoreOptions;
      createOptions: TranslatorCreateCoreOptions;
    }
  | {
      apiName: "LanguageDetector";
      factory: typeof LanguageDetector;
      availabilityOptions?: LanguageDetectorCreateCoreOptions;
      createOptions?: LanguageDetectorCreateCoreOptions;
    }
  | {
      apiName: "LanguageModel";
      factory: typeof LanguageModel;
      availabilityOptions?: LanguageModelCreateCoreOptions;
      createOptions?: LanguageModelCreateCoreOptions;
    };

function languageModelFactory(): typeof LanguageModel | undefined {
  if (typeof LanguageModel !== "undefined") {
    return LanguageModel;
  }
  const ai = (globalThis as typeof globalThis & { ai?: { languageModel?: typeof LanguageModel } })
    .ai;
  return ai?.languageModel;
}

function modelIdHint(model: WebBrowserModelConfig | undefined): string {
  const pc = model?.provider_config as { model_name?: string } | undefined;
  return String(model?.model_id ?? pc?.model_name ?? "").toLowerCase();
}

/**
 * Maps a {@link WebBrowserModelConfig} to the Chrome Built-in AI factory that owns
 * its on-device weights (Prompt / Summarizer / Translator / Rewriter / Language Detector).
 */
export function resolveWebBrowserApi(
  model: WebBrowserModelConfig | undefined
): WebBrowserApiBinding {
  const id = modelIdHint(model);

  if (/summariz/.test(id)) {
    return {
      apiName: "Summarizer",
      factory: getApi("Summarizer", typeof Summarizer !== "undefined" ? Summarizer : undefined),
    };
  }
  if (/rewrit/.test(id)) {
    return {
      apiName: "Rewriter",
      factory: getApi("Rewriter", typeof Rewriter !== "undefined" ? Rewriter : undefined),
    };
  }
  if (/translat/.test(id)) {
    return {
      apiName: "Translator",
      factory: getApi("Translator", typeof Translator !== "undefined" ? Translator : undefined),
      availabilityOptions: { ...DEFAULT_TRANSLATOR_LANGS },
      createOptions: { ...DEFAULT_TRANSLATOR_LANGS },
    };
  }
  if (/language[-_]?detect/.test(id)) {
    return {
      apiName: "LanguageDetector",
      factory: getApi(
        "LanguageDetector",
        typeof LanguageDetector !== "undefined" ? LanguageDetector : undefined
      ),
    };
  }

  const factory = languageModelFactory();
  return {
    apiName: "LanguageModel",
    factory: getApi("LanguageModel", factory),
    availabilityOptions: { ...LANGUAGE_MODEL_AVAILABILITY_OPTIONS },
    createOptions: {},
  };
}

export function isWebBrowserModelCached(availability: Availability): boolean {
  return availability === "available";
}
