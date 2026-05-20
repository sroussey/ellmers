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

import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

/**
 * Single-shot text generation. `TextGenerationTask` doesn't allocate a
 * session id (only stateful tasks like {@link AiChatTask} do), so this path
 * always creates a fresh session and destroys it at the end of the turn.
 * Multi-turn chat is handled by {@link WebBrowser_Chat}, which reuses
 * sessions via the {@link deleteChromeSession} disposer wired into
 * `ResourceScope`.
 *
 * `temperature` is `@deprecated` for non-extension contexts in the current
 * Chrome spec and silently ignored on the open web. Passed through anyway
 * so extension callers still get the knob.
 */
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
    signal,
    temperature: input.temperature ?? undefined,
    monitor: createDownloadMonitor(emit),
  });
  try {
    const stream = session.promptStreaming(input.prompt, { signal });
    for await (const e of snapshotStreamToTextDeltas<TextGenerationTaskOutput>(
      stream,
      "text",
      (text) => ({
        text,
      })
    )) {
      emit(e);
    }
  } finally {
    session.destroy();
  }
};
