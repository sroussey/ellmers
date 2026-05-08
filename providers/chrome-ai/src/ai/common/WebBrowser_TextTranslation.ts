/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";

import { AIAvailability } from "./WebBrowser_ChromeAI";
import { ensureAvailable, getApi, snapshotStreamToSnapshots } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi("Translator", typeof Translator !== "undefined" ? Translator : undefined);
  await ensureAvailable("Translator", factory);

  const translationAvailability = await factory.availability({
    sourceLanguage: input.source_lang,
    targetLanguage: input.target_lang,
  });
  if (!translationAvailability || translationAvailability === "unavailable") {
    throw new PermanentJobError(
      `Translator not available for language pair ${String(
        input.source_lang
      )} -> ${String(input.target_lang)}`
    );
  }

  const translator = await factory.create({
    sourceLanguage: input.source_lang,
    targetLanguage: input.target_lang,
  });
  try {
    const text = await translator.translate(input.text, { signal });
    update_progress(100, "Completed text translation");
    return { text, target_lang: input.target_lang };
  } finally {
    translator.destroy();
  }
};

export const WebBrowser_TextTranslation_Stream: AiProviderStreamFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextTranslationTaskOutput>> {
  const factory = getApi("Translator", typeof Translator !== "undefined" ? Translator : undefined);
  let status: AIAvailability;
  try {
    status = await factory.availability({
      sourceLanguage: input.source_lang,
      targetLanguage: input.target_lang,
    });
  } catch {
    throw new PermanentJobError(
      `Chrome Built-in AI "Translator" is not available (status: "no"). ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }
  if (status === "unavailable") {
    throw new PermanentJobError(
      `Chrome Built-in AI "Translator" is not available (status: "no"). ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }

  const translator = await factory.create({
    sourceLanguage: input.source_lang,
    targetLanguage: input.target_lang,
  });
  try {
    const stream = translator.translateStreaming(input.text, { signal });
    yield* snapshotStreamToSnapshots<TextTranslationTaskOutput>(stream, (text) => ({
      text,
      target_lang: input.target_lang,
    }));
  } finally {
    translator.destroy();
  }
};
