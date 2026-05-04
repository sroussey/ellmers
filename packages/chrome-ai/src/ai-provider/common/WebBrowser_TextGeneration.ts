/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";

import { ensureAvailable, getApi, snapshotStreamToTextDeltas } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  const session = await factory.create({
    temperature: input.temperature ?? undefined,
  });
  try {
    const text = await session.prompt(input.prompt, { signal });
    update_progress(100, "Completed text generation");
    return { text };
  } finally {
    session.destroy();
  }
};

export const WebBrowser_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  const session = await factory.create({
    temperature: input.temperature ?? undefined,
  });
  try {
    const stream = session.promptStreaming(input.prompt, { signal });
    yield* snapshotStreamToTextDeltas<TextGenerationTaskOutput>(stream, "text", (text) => ({
      text,
    }));
  } finally {
    session.destroy();
  }
};
