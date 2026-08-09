/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord, SessionDisposalResult } from "@workglow/ai";
import { AiProvider, getAiProviderRegistry, noopEmit } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { TaskInput } from "@workglow/task-graph";
import { deleteGeminiCachedContent } from "./common/Gemini_CacheStore";
import { geminiWorkerRunFnSpecs, inferGeminiCapabilities } from "./common/Gemini_Capabilities";
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

/**
 * Main-thread registration shell for Google Gemini. Used both for inline mode
 * (constructed with the run-fn registrations array) and worker-backed mode
 * (constructed empty so the base class registers worker proxies). No queue
 * is created — Google Gemini uses {@link DirectExecutionStrategy}.
 */
export class GoogleGeminiQueuedProvider extends createCloudProviderClass<GeminiModelConfig>(
  AiProvider,
  {
    name: GOOGLE_GEMINI,
    displayName: "Google Gemini",
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferGeminiCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return geminiWorkerRunFnSpecs();
  }

  override async disposeSession(sessionId: string): Promise<SessionDisposalResult | undefined> {
    const disposeFn = getAiProviderRegistry().getRunFnFor(this.name, ["session.dispose"]);
    if (disposeFn) {
      // The worker-side run-fn deletes the cache in the runtime that owns it,
      // but a Promise+emit run-fn carries no return channel back to the
      // caller, so a worker-dispatched dispose has nothing to report here.
      await disposeFn(
        {} as TaskInput,
        undefined,
        AbortSignal.timeout(30_000),
        noopEmit,
        undefined,
        { sessionId }
      );
      return undefined;
    }

    // An unregistered inline provider still owns its cache in this runtime.
    return await deleteGeminiCachedContent(sessionId);
  }
}
