/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Capability,
  ModelEffortPolicy,
  ModelPricing,
  ModelRecord,
  SessionDisposalResult,
} from "@workglow/ai";
import { accumulatingEmit, AiProvider, getAiProviderRegistry } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import type { TaskInput } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import { deleteGeminiCachedContent } from "./common/Gemini_CacheStore";
import { geminiWorkerRunFnSpecs, inferGeminiCapabilities } from "./common/Gemini_Capabilities";
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import { geminiEffortPolicy } from "./common/Gemini_EffortPolicy";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";
import { getGeminiModelPricing } from "./common/Gemini_Pricing";

/**
 * Narrows the collected `finish` payload to a real {@link SessionDisposalResult}.
 * The run-fn reports `{}` when it had nothing to release; `lifetimeMs` is the
 * one field only a genuine disposal carries, so its presence as a number is
 * what distinguishes "released, N ms" from "nothing to report" — never fabricate
 * the other case as a zero.
 */
function isSessionDisposalResult(value: unknown): value is SessionDisposalResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { lifetimeMs?: unknown }).lifetimeMs === "number"
  );
}

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

  override effortPolicy(model: GeminiModelConfig): ModelEffortPolicy | undefined {
    return geminiEffortPolicy(model);
  }

  override modelPricing(model: GeminiModelConfig): ModelPricing | undefined {
    const modelName = (model.provider_config?.model_name as string | undefined) ?? model.model_id;
    return getGeminiModelPricing(modelName);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return geminiWorkerRunFnSpecs();
  }

  override async disposeSession(sessionId: string): Promise<SessionDisposalResult | undefined> {
    const disposeFn = getAiProviderRegistry().getRunFnFor(this.name, ["session.dispose"]);
    if (disposeFn) {
      // The worker-side run-fn deletes the cache in the runtime that owns it
      // and reports what it released via its `finish` event; collect that
      // through the Promise+emit terminal-consumer helper so a worker-dispatched
      // dispose reports the same result an inline dispose returns directly.
      const { emit, result } = accumulatingEmit();
      await disposeFn({} as TaskInput, undefined, AbortSignal.timeout(30_000), emit, undefined, {
        sessionId,
      });
      let released: unknown;
      try {
        released = result();
      } catch (err) {
        // The run-fn already deleted the cache; a missing or malformed `finish`
        // only costs the telemetry read, so report nothing rather than failing
        // teardown. Dispatch failures still propagate — those may mean the
        // delete never happened.
        getLogger().warn("Gemini session dispose reported no result", { sessionId, error: err });
        return undefined;
      }
      return isSessionDisposalResult(released) ? released : undefined;
    }

    // An unregistered inline provider still owns its cache in this runtime.
    return await deleteGeminiCachedContent(sessionId);
  }
}
