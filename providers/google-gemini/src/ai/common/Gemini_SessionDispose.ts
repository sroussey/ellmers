/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { deleteGeminiCachedContent } from "./Gemini_CacheStore";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

export const Gemini_SessionDispose: AiProviderRunFn<
  TaskInput,
  TaskOutput,
  GeminiModelConfig
> = async (_input, _model, _signal, emit, _outputSchema, session) => {
  if (session?.sessionId) {
    await deleteGeminiCachedContent(session.sessionId);
  }
  emit({ type: "finish", data: {} });
};
