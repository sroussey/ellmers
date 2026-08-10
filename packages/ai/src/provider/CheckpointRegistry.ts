/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
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
  /** Model the charge is priced against. */
  readonly modelId: string | undefined;
}

/**
 * Where a checkpoint's disposal-time storage charge is reported.
 *
 * Held beside the entry rather than passed to each disposal site, because a
 * checkpoint is usually disposed by a task other than the one that minted it —
 * a chained emit supersedes its parent inline, and the run's `ResourceScope`
 * disposes whatever is left at run end. Keying the sink to the checkpoint id
 * makes the charge reach the minter from any of those sites.
 */
export type CheckpointUsageSink = (usage: Usage, modelId: string | undefined) => void;

const checkpoints = new Map<string, CheckpointEntry>();
const usageSinks = new Map<string, CheckpointUsageSink>();

export function registerCheckpoint(id: string, entry: CheckpointEntry): void {
  checkpoints.set(id, entry);
}

export function getCheckpoint(id: string): CheckpointEntry | undefined {
  return checkpoints.get(id);
}

export function deleteCheckpoint(id: string): boolean {
  usageSinks.delete(id);
  return checkpoints.delete(id);
}

/**
 * Attribute a checkpoint's eventual storage charge to `sink`. Registered by the
 * task that mints the checkpoint; consumed by {@link disposeCheckpoint}.
 */
export function setCheckpointUsageSink(id: string, sink: CheckpointUsageSink): void {
  usageSinks.set(id, sink);
}

export function getCheckpointUsageSink(id: string): CheckpointUsageSink | undefined {
  return usageSinks.get(id);
}

/** @internal Test-only reset. */
export function clearCheckpointsForTesting(): void {
  checkpoints.clear();
  usageSinks.clear();
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
