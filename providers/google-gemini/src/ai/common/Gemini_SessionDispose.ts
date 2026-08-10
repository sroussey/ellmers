/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { deleteGeminiCachedContent } from "./Gemini_CacheStore";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

/**
 * One-shot `["session.dispose"]` run-fn: deletes the checkpoint's server-side
 * CachedContent, if any, and reports what was released — token count and
 * lifetime — as its `finish` payload, so a worker-dispatched dispose reports
 * the same `SessionDisposalResult` shape an inline dispose returns directly.
 */
export const Gemini_SessionDispose: AiProviderRunFn<
  TaskInput,
  TaskOutput,
  GeminiModelConfig
> = async (_input, _model, _signal, emit, _outputSchema, session) => {
  const released = session?.sessionId
    ? await deleteGeminiCachedContent(session.sessionId)
    : undefined;
  emit({ type: "finish", data: released ?? {} });
};
