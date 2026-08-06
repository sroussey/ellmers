/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai/worker";
import { getAiProviderRegistry } from "@workglow/ai/worker";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { deleteHftSession } from "./HFT_Pipeline";

/**
 * One-shot `["session.dispose"]` run-fn: deletes the session/checkpoint KV
 * snapshot from the runtime that executes it. Registered in the worker run-fn
 * specs so worker-backed registrations dispose the WORKER's map entry (the
 * runtime that actually holds the DynamicCache tensors).
 */
export const HFT_SessionDispose: AiProviderRunFn<
  TaskInput,
  TaskOutput,
  HfTransformersOnnxModelConfig
> = async (_input, _model, _signal, emit, _outputSchema, session) => {
  if (session?.sessionId) {
    deleteHftSession(session.sessionId);
  }
  emit({ type: "finish", data: {} });
};

/**
 * Dispose a session's KV state through the registered `["session.dispose"]`
 * run-fn when one exists — in worker-backed registrations that run-fn is a
 * worker proxy, so the delete executes inside the worker runtime that owns
 * the session map (a main-thread `deleteHftSession` would be a silent no-op
 * there and leak the worker-side DynamicCache tensors per checkpoint). Falls
 * back to the local module map when no run-fn is registered (inline runtimes,
 * the worker itself, unregistered providers in tests).
 */
export async function disposeHftSessionViaRegistry(
  providerName: string,
  sessionId: string
): Promise<void> {
  const disposeFn = getAiProviderRegistry().getRunFnFor(providerName, ["session.dispose"]);
  if (disposeFn) {
    await disposeFn({} as TaskInput, undefined, AbortSignal.timeout(30_000), () => {}, undefined, {
      sessionId,
    });
    return;
  }
  deleteHftSession(sessionId);
}
