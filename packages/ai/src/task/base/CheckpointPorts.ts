/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import type { ModelConfig } from "../../model/ModelSchema";
import type { AiSessionContext } from "../../provider/AiProviderRegistry";
import { getAiProviderRegistry } from "../../provider/AiProviderRegistry";
import type { CheckpointEntry, CheckpointPrefix } from "../../provider/CheckpointRegistry";
import {
  checkpointModelKey,
  deleteCheckpoint,
  getCheckpoint,
  registerCheckpoint,
  requireCheckpointModelKey,
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
  readonly checkpoint?: string | undefined;
  readonly emitCheckpoint?: boolean | undefined;
  readonly keepParentCheckpoint?: boolean | undefined;
}

export interface ResolvedCheckpoint {
  readonly session: AiSessionContext;
  readonly emitCheckpointId: string | undefined;
  readonly parentId: string | undefined;
  readonly parentEntry: CheckpointEntry | undefined;
}

/**
 * Validates a parent checkpoint id against the registry and the task's model,
 * returning the registry entry. Throws {@link TaskConfigurationError} on
 * unknown ids and provider / model-key mismatches.
 */
export function validateParentCheckpoint(
  checkpointId: string,
  model: ModelConfig,
  taskType: string
): CheckpointEntry {
  const parentEntry = getCheckpoint(checkpointId);
  if (!parentEntry) {
    throw new TaskConfigurationError(`${taskType}: unknown cache checkpoint "${checkpointId}".`);
  }
  if (parentEntry.provider !== model.provider) {
    throw new TaskConfigurationError(
      `${taskType}: checkpoint "${checkpointId}" belongs to provider ` +
        `"${parentEntry.provider}" but the model uses "${model.provider}".`
    );
  }
  // Route the current model's key through the strict helper so an unnameable
  // model fails loudly instead of silently sharing a fungible checkpoint slot.
  const key = requireCheckpointModelKey(model, taskType);
  if (parentEntry.modelKey !== key) {
    throw new TaskConfigurationError(
      `${taskType}: checkpoint "${checkpointId}" was created for model ` +
        `"${parentEntry.modelKey}" but the task model is "${key}".`
    );
  }
  return parentEntry;
}

/**
 * Merges new prefix content onto a parent checkpoint's prefix: scalar fields
 * fall back to the parent's, messages append after the parent's.
 */
export function mergeCheckpointPrefix(
  parentPrefix: CheckpointPrefix | undefined,
  content: {
    readonly systemPrompt: string | undefined;
    readonly tools: readonly ToolDefinition[] | undefined;
    readonly messages: readonly ChatMessage[];
  }
): CheckpointPrefix {
  return {
    systemPrompt: content.systemPrompt ?? parentPrefix?.systemPrompt,
    tools: content.tools ?? parentPrefix?.tools,
    messages: [...(parentPrefix?.messages ?? []), ...content.messages],
  };
}

/**
 * Resolves the checkpoint ports of a task input into an {@link AiSessionContext}.
 * Returns undefined when neither port is used. Throws on unknown checkpoint ids,
 * provider/model mismatches, and providers without cache-checkpoint support —
 * before any provider dispatch.
 */
export function resolveCheckpointSession(
  input: CheckpointPortsInput,
  model: ModelConfig,
  taskType: string
): ResolvedCheckpoint | undefined {
  if (!input.checkpoint && !input.emitCheckpoint) return undefined;

  // Providers that never registered a cache.checkpoint run-fn ignore
  // session.prefix / emitCheckpointId entirely, which would silently drop the
  // checkpoint's context (consume) or return a handle backed by nothing (emit).
  // Fail loudly instead, mirroring the dispatch error CacheCheckpointTask gets.
  if (!getAiProviderRegistry().getRunFnFor(model.provider, ["cache.checkpoint"])) {
    throw new TaskConfigurationError(
      `${taskType}: provider "${model.provider}" does not support cache checkpoints ` +
        `(no run function serving ["cache.checkpoint"]).`
    );
  }

  // A keyless model can never be safely tied to a checkpoint id — validate the
  // current model up-front so an emit path (which never runs validateParent)
  // also fails before createSession mints a slot that would later collide.
  requireCheckpointModelKey(model, taskType);

  const parentEntry: CheckpointEntry | undefined = input.checkpoint
    ? validateParentCheckpoint(input.checkpoint, model, taskType)
    : undefined;

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
  /**
   * Omit when the turn produced no content: an empty assistant message in the
   * prefix is rejected on replay by some providers (Anthropic 400s on empty
   * content arrays and empty text blocks).
   */
  readonly assistantMessage: ChatMessage | undefined;
  readonly systemPrompt: string | undefined;
  readonly tools: readonly ToolDefinition[] | undefined;
}): Promise<void> {
  const { model, resolved } = opts;
  if (!resolved.emitCheckpointId) return;
  registerCheckpoint(resolved.emitCheckpointId, {
    provider: model.provider,
    modelKey: checkpointModelKey(model),
    prefix: mergeCheckpointPrefix(resolved.parentEntry?.prefix, {
      systemPrompt: opts.systemPrompt,
      tools: opts.tools,
      messages: [...opts.tailMessages, ...(opts.assistantMessage ? [opts.assistantMessage] : [])],
    }),
    createdAtMs: Date.now(),
    tokens: undefined,
    ownerTaskId: undefined,
    modelId: model.model_id,
    ...(resolved.parentId ? { parentId: resolved.parentId } : {}),
  });
  if (resolved.session.supersedeParent && resolved.parentId) {
    try {
      await getAiProviderRegistry().disposeSession(model.provider, resolved.parentId);
    } catch {
      // Best-effort: a parent-dispose failure (worker restarted, transport
      // error) must not fail a task whose generation already succeeded. The
      // parent's scope disposer retries at run end and dispose is idempotent.
    }
    deleteCheckpoint(resolved.parentId);
  }
}
