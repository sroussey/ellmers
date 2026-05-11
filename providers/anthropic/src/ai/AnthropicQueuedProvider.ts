/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { Capability, ModelRecord } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { ANTHROPIC } from "./common/Anthropic_Constants";
import {
  inferAnthropicCapabilities,
  anthropicWorkerRunFnSpecs,
} from "./common/Anthropic_Capabilities";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

/**
 * Main-thread registration shell for Anthropic. Used both for inline mode
 * (constructed with the run-fn registrations array) and worker-backed mode
 * (constructed empty so the base class registers worker proxies).
 *
 * **No queue is created** — Anthropic uses {@link DirectExecutionStrategy}.
 * The `Queued` suffix is a historical artefact from when each provider
 * paired with a per-provider {@link JobQueue}; the class name is retained
 * only to avoid churning every import site.
 *
 * Note: Anthropic does not offer an embeddings API.
 */
export class AnthropicQueuedProvider extends createCloudProviderClass<AnthropicModelConfig>(
  AiProvider,
  {
    name: ANTHROPIC,
    displayName: "Anthropic",
  }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferAnthropicCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return anthropicWorkerRunFnSpecs();
  }
}
