/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { Capability, ModelRecord, SessionDisposalResult } from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { deleteGeminiCachedContent } from "./common/Gemini_CacheStore";
import { geminiWorkerRunFnSpecs, inferGeminiCapabilities } from "./common/Gemini_Capabilities";
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

/**
 * Worker-server registration for Google Gemini cloud models. Imports
 * `AiProvider` from `@workglow/ai/worker` so the SDK is only loaded in the
 * worker.
 *
 * The class extends the {@link createCloudProviderClass} mixin (which
 * supplies `name` / `displayName` / `isLocal` / `supportsBrowser`) and adds
 * the Gemini-specific {@link AiProvider.inferCapabilities} and
 * {@link AiProvider.workerRunFnSpecs} overrides.
 */
export class GoogleGeminiProvider extends createCloudProviderClass<GeminiModelConfig>(AiProvider, {
  name: GOOGLE_GEMINI,
  displayName: "Google Gemini",
}) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferGeminiCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return geminiWorkerRunFnSpecs();
  }

  override async disposeSession(sessionId: string): Promise<SessionDisposalResult | undefined> {
    // Checkpoint ids may map to server-side CachedContent, which bills storage
    // per token-hour until its TTL — delete eagerly on dispose.
    return await deleteGeminiCachedContent(sessionId);
  }
}
