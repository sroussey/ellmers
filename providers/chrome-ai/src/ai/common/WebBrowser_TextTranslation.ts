/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";

import { AIAvailability } from "./WebBrowser_ChromeAI";
import { ensureAvailable, getApi, snapshotStreamToSnapshots } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextTranslation: AiProviderStreamFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async function* (
  input,
  _model,
  signal
): AsyncIterable<StreamEvent<TextTranslationTaskOutput>> {
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

  await ensureAvailable("Translator", factory);

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
