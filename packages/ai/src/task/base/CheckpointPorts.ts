/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import type { ModelConfig } from "../../model/ModelSchema";
import type { AiSessionContext } from "../../provider/AiProviderRegistry";
import { getAiProviderRegistry } from "../../provider/AiProviderRegistry";
import type { CheckpointEntry } from "../../provider/CheckpointRegistry";
import {
  checkpointModelKey,
  deleteCheckpoint,
  getCheckpoint,
  registerCheckpoint,
} from "../../provider/CheckpointRegistry";
import type { ChatMessage, ContentBlock } from "../ChatMessage";
import type { ToolDefinition } from "../ToolCallingUtils";

/** Input-schema fragments for tasks that can consume / emit cache checkpoints. */
export const CheckpointInputProperties = {
  checkpoint: {
    type: "string",
    format: "cache-checkpoint",
    title: "Checkpoint",
    description: "Cache checkpoint to start from; provide only messages after it",
  },
  emitCheckpoint: {
    type: "boolean",
    title: "Emit Checkpoint",
    description: "Snapshot post-turn state as a new checkpoint on the checkpoint output port",
    "x-ui-group": "Configuration",
  },
  keepParentCheckpoint: {
    type: "boolean",
    title: "Keep Parent Checkpoint",
    description: "Keep the consumed checkpoint alive after emitting a new one (for branching)",
    "x-ui-group": "Configuration",
  },
} as const;

/** Output-schema fragment for the emitted checkpoint port. */
export const CheckpointOutputProperty = {
  checkpoint: {
    type: "string",
    format: "cache-checkpoint",
    title: "Checkpoint",
    description: "New checkpoint including this turn (set when emitCheckpoint is true)",
    "x-stream": "append",
  },
} as const;

export interface CheckpointPortsInput {
  readonly checkpoint?: string;
  readonly emitCheckpoint?: boolean;
  readonly keepParentCheckpoint?: boolean;
}

export interface ResolvedCheckpoint {
  readonly session: AiSessionContext;
  readonly emitCheckpointId: string | undefined;
  readonly parentId: string | undefined;
  readonly parentEntry: CheckpointEntry | undefined;
}

/**
 * Resolves the checkpoint ports of a task input into an {@link AiSessionContext}.
 * Returns undefined when neither port is used. Throws on unknown checkpoint ids
 * and provider/model mismatches — before any provider dispatch.
 */
export function resolveCheckpointSession(
  input: CheckpointPortsInput,
  model: ModelConfig,
  taskType: string
): ResolvedCheckpoint | undefined {
  if (!input.checkpoint && !input.emitCheckpoint) return undefined;

  let parentEntry: CheckpointEntry | undefined;
  if (input.checkpoint) {
    parentEntry = getCheckpoint(input.checkpoint);
    if (!parentEntry) {
      throw new TaskConfigurationError(
        `${taskType}: unknown cache checkpoint "${input.checkpoint}".`
      );
    }
    if (parentEntry.provider !== model.provider) {
      throw new TaskConfigurationError(
        `${taskType}: checkpoint "${input.checkpoint}" belongs to provider ` +
          `"${parentEntry.provider}" but the model uses "${model.provider}".`
      );
    }
    const key = checkpointModelKey(model);
    if (parentEntry.modelKey && key && parentEntry.modelKey !== key) {
      throw new TaskConfigurationError(
        `${taskType}: checkpoint "${input.checkpoint}" was created for model ` +
          `"${parentEntry.modelKey}" but the task model is "${key}".`
      );
    }
  }

  const emitCheckpointId = input.emitCheckpoint
    ? getAiProviderRegistry().createSession(model.provider, model)
    : undefined;

  const supersedeParent =
    emitCheckpointId !== undefined && input.checkpoint !== undefined && !input.keepParentCheckpoint
      ? true
      : undefined;

  return {
    session: {
      ...(input.checkpoint ? { sessionId: input.checkpoint } : {}),
      ...(emitCheckpointId ? { emitCheckpointId } : {}),
      ...(supersedeParent ? { supersedeParent } : {}),
      ...(parentEntry ? { prefix: parentEntry.prefix } : {}),
    },
    emitCheckpointId,
    parentId: input.checkpoint,
    parentEntry,
  };
}

/** Normalizes a task `prompt` (string or block array) into a user ChatMessage. */
export function promptToUserMessage(prompt: unknown): ChatMessage {
  if (typeof prompt === "string") {
    return { role: "user", content: [{ type: "text", text: prompt }] };
  }
  if (Array.isArray(prompt)) {
    const blocks = prompt.map((p): ContentBlock => {
      if (typeof p === "string") return { type: "text", text: p };
      return p as ContentBlock;
    });
    return { role: "user", content: blocks };
  }
  return { role: "user", content: [{ type: "text", text: String(prompt ?? "") }] };
}

/**
 * Records the emitted checkpoint's registry entry (parent prefix + this turn)
 * and supersedes the parent when requested. Call only after the provider call
 * finished successfully.
 */
export async function finalizeEmittedCheckpoint(opts: {
  readonly model: ModelConfig;
  readonly resolved: ResolvedCheckpoint;
  readonly tailMessages: readonly ChatMessage[];
  readonly assistantMessage: ChatMessage;
  readonly systemPrompt: string | undefined;
  readonly tools: readonly ToolDefinition[] | undefined;
}): Promise<void> {
  const { model, resolved } = opts;
  if (!resolved.emitCheckpointId) return;
  const parentPrefix = resolved.parentEntry?.prefix;
  registerCheckpoint(resolved.emitCheckpointId, {
    provider: model.provider,
    modelKey: checkpointModelKey(model),
    prefix: {
      systemPrompt: opts.systemPrompt ?? parentPrefix?.systemPrompt,
      tools: opts.tools ?? parentPrefix?.tools,
      messages: [...(parentPrefix?.messages ?? []), ...opts.tailMessages, opts.assistantMessage],
    },
    ...(resolved.parentId ? { parentId: resolved.parentId } : {}),
  });
  if (resolved.session.supersedeParent && resolved.parentId) {
    await getAiProviderRegistry().disposeSession(model.provider, resolved.parentId);
    deleteCheckpoint(resolved.parentId);
  }
}
