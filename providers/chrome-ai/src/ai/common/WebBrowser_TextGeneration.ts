/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";

import { ensureAvailable, getApi, snapshotStreamToTextDeltas } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextGeneration: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  WebBrowserModelConfig
> = async function* (input, _model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
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
