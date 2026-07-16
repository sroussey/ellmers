/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "../model/ModelSchema";
import type { ChatMessage } from "../task/ChatMessage";
import type { ToolDefinition } from "../task/ToolCallingUtils";

/**
 * The prompt-prefix content a cache checkpoint stands for. Cloud providers
 * replay this ahead of the caller's tail; local providers use it to re-encode
 * when worker-side KV state is gone.
 */
export interface CheckpointPrefix {
  readonly systemPrompt?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly messages?: readonly ChatMessage[];
}

/** Main-thread record for one checkpoint id (a provider session id). */
export interface CheckpointEntry {
  readonly provider: string;
  /** Model identity for mismatch checks; empty string when the model has no id. */
  readonly modelKey: string;
  readonly prefix: CheckpointPrefix;
  readonly parentId?: string;
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
