/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
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

  override async disposeSession(sessionId: string): Promise<void> {
    // Checkpoint ids may map to server-side CachedContent, which bills storage
    // per token-hour until its TTL — delete eagerly on dispose. In worker mode
    // the entry lives in the worker's store, making this a no-op there; the
    // cache's TTL is the backstop.
    await deleteGeminiCachedContent(sessionId);
  }
}
