/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";

import { ensureAvailable, getApi, snapshotStreamToTextDeltas } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit) => {
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
    for await (const e of snapshotStreamToTextDeltas<TextGenerationTaskOutput>(stream, "text", (text) => ({
      text,
    }))) { emit(e); }
  } finally {
    session.destroy();
  }
};
