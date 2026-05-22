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

import { assertAvailability, getApi, snapshotStreamToSnapshots } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit) => {
  const factory = getApi("Translator", typeof Translator !== "undefined" ? Translator : undefined);
  const langOptions: TranslatorCreateCoreOptions = {
    sourceLanguage: input.source_lang,
    targetLanguage: input.target_lang,
  };
  let status: Availability;
  try {
    status = await factory.availability(langOptions);
  } catch {
    throw new PermanentJobError(
      `Chrome Built-in AI "Translator" is not available (status: "no"). ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }
  assertAvailability("Translator", status);

  const translator = await factory.create(langOptions);
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
