/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";

import { assertAvailability, getApi } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit) => {
  const factory = getApi(
    "LanguageDetector",
    typeof LanguageDetector !== "undefined" ? LanguageDetector : undefined
  );
  assertAvailability("LanguageDetector", await factory.availability());

  const detector = await factory.create();
  try {
    const detected = await detector.detect(input.text, { signal });
    const languages = detected
      .flatMap((d) =>
        d.detectedLanguage !== undefined && d.confidence !== undefined
          ? [{ language: d.detectedLanguage, score: d.confidence }]
          : []
      )
      .slice(0, input.maxLanguages ?? 5);
    emit({ type: "finish", data: { languages } });
  } finally {
    detector.destroy();
  }
};
