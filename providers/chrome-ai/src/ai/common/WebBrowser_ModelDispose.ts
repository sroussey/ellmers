/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  disposeWebBrowserSession,
  disposeWebBrowserSessionsForModel,
  getWebBrowserModelKey,
} from "./WebBrowser_Sessions";

export interface WebBrowserModelDisposeInput extends TaskInput {
  readonly model: WebBrowserModelConfig;
  readonly sessionId?: string;
}

export interface WebBrowserModelDisposeOutput extends TaskOutput {
  readonly model: string;
}

export const WebBrowser_ModelDispose: AiProviderRunFn<
  WebBrowserModelDisposeInput,
  WebBrowserModelDisposeOutput,
  WebBrowserModelConfig
> = async (input, model, _signal, emit) => {
  if (input.sessionId) {
    await disposeWebBrowserSession(input.sessionId);
  } else {
    await disposeWebBrowserSessionsForModel(getWebBrowserModelKey(model ?? input.model));
  }
  emit({
    type: "finish",
    data: { model: input.model.model_id ?? getWebBrowserModelKey(input.model) },
  });
};
