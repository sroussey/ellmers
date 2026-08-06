/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { deleteLlamaCppSession } from "./LlamaCpp_Runtime";

/**
 * `["session.dispose"]` run-fn: frees the runtime-side session state (chat
 * session + context sequence) registered under `session.sessionId`. Registered
 * as a run-fn so a worker-backed provider's `disposeSession` executes in the
 * runtime that owns `llamaCppSessions` — a main-thread `deleteLlamaCppSession`
 * call would be a silent no-op there and leak the sequence-pool slot.
 * One-shot convention: a single `finish` event carrying the (empty) output.
 */
export const LlamaCpp_SessionDispose: AiProviderRunFn<
  TaskInput,
  TaskOutput,
  LlamaCppModelConfig
> = async (_input, _model, _signal, emit, _outputSchema, session) => {
  if (session?.sessionId) {
    await deleteLlamaCppSession(session.sessionId);
  }
  emit({ type: "finish", data: {} });
};
