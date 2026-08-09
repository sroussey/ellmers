/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import type { ModelConfig } from "../model/ModelSchema";
import type { ChatMessage } from "../task/ChatMessage";
import type { ToolDefinition } from "../task/ToolCallingUtils";

/**
 * The prompt-prefix content a cache checkpoint stands for. Cloud providers
 * replay this ahead of the caller's tail; local providers use it to re-encode
 * when worker-side KV state is gone.
 */
export interface CheckpointPrefix {
  readonly systemPrompt?: string | undefined;
  readonly tools?: readonly ToolDefinition[] | undefined;
  readonly messages?: readonly ChatMessage[] | undefined;
}

/** Main-thread record for one checkpoint id (a provider session id). */
export interface CheckpointEntry {
  readonly provider: string;
  /** Model identity for mismatch checks; empty string when the model has no id. */
  readonly modelKey: string;
  readonly prefix: CheckpointPrefix;
  readonly parentId?: string | undefined;
  /** When the warm-up created this checkpoint; the storage-charge start. */
  readonly createdAtMs: number;
  /** Prefix tokens the provider reported writing, when it stated one. */
  readonly tokens: number | undefined;
  /** Task that created it, so a late storage charge can be attributed. */
  readonly ownerTaskId: string | undefined;
  /** Model the charge is priced against. */
  readonly modelId: string | undefined;
}

const checkpoints = new Map<string, CheckpointEntry>();

export function registerCheckpoint(id: string, entry: CheckpointEntry): void {
  checkpoints.set(id, entry);
}

export function getCheckpoint(id: string): CheckpointEntry | undefined {
  return checkpoints.get(id);
}

export function deleteCheckpoint(id: string): boolean {
  return checkpoints.delete(id);
}

/** @internal Test-only reset. */
export function clearCheckpointsForTesting(): void {
  checkpoints.clear();
}

/** Model identity string used for checkpoint/model mismatch checks. */
export function checkpointModelKey(model: ModelConfig): string {
  return typeof model.model_id === "string" ? model.model_id : "";
}

/**
 * Strict sibling of {@link checkpointModelKey} — throws when the model has no
 * usable identity string. Empty model keys used to silently pass through the
 * short-circuited mismatch check, letting two keyless models on the same
 * provider share a fungible checkpoint slot (cross-model contamination).
 * Every mint / validate site must route through this helper.
 */
export function requireCheckpointModelKey(model: ModelConfig, taskType: string): string {
  const key = checkpointModelKey(model);
  if (!key) {
    throw new TaskConfigurationError(
      `${taskType}: model has no model_id — a cache checkpoint requires a stable ` +
        `model identity to guard against cross-model contamination.`
    );
  }
  return key;
}
