/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";

import {
  createDownloadMonitor,
  getChromeGlobal,
  getApi,
  snapshotStreamToSnapshots,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit) => {
  const factory = getApi("Translator", getChromeGlobal<typeof Translator>("Translator"));

  const status = await factory.availability({
    sourceLanguage: input.source_lang,
    targetLanguage: input.target_lang,
  });
  if (status === "unavailable") {
    throw new PermanentJobError(
      `Chrome Built-in AI "Translator" is not available for ${input.source_lang} → ${input.target_lang}. ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }

  const translator = await factory.create({
    signal,
    sourceLanguage: input.source_lang,
    targetLanguage: input.target_lang,
    monitor: createDownloadMonitor(emit),
  });
  try {
    const stream = translator.translateStreaming(input.text, { signal });
    for await (const e of snapshotStreamToSnapshots<TextTranslationTaskOutput>(stream, (text) => ({
      text,
      target_lang: input.target_lang,
    }))) {
      emit(e);
    }
  } finally {
    translator.destroy();
  }
};
