/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, TaskConfigurationError, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import type { CheckpointEntry, CheckpointPrefix } from "../provider/CheckpointRegistry";
import {
  deleteCheckpoint,
  registerCheckpoint,
  requireCheckpointModelKey,
} from "../provider/CheckpointRegistry";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";
import { mergeCheckpointPrefix, validateParentCheckpoint } from "./base/CheckpointPorts";
import type { ChatMessage } from "./ChatMessage";
import { ChatMessageSchema } from "./ChatMessage";
import { ToolDefinitionSchema } from "./ToolCallingTask";
import type { ToolDefinition } from "./ToolCallingUtils";

const modelSchema = TypeModel("model:CacheCheckpointTask");

export const CacheCheckpointInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    systemPrompt: {
      type: "string",
      title: "System Prompt",
      description: "System instructions included in the cached prefix",
    },
    tools: {
      type: "array",
      format: "tasks",
      title: "Tools",
      description: "Tool definitions included in the cached prefix",
      items: {
        oneOf: [
          { type: "string", format: "tasks", description: "Task type name" },
          ToolDefinitionSchema,
        ],
      },
    },
    messages: {
      type: "array",
      title: "Messages",
      description: "Conversation messages included in the cached prefix",
      items: ChatMessageSchema,
    },
    checkpoint: {
      type: "string",
      format: "cache-checkpoint",
      title: "Parent Checkpoint",
      description: "Existing checkpoint to extend; its prefix is prepended",
    },
    keepParent: {
      type: "boolean",
      title: "Keep Parent",
      description: "Keep the parent checkpoint alive after extending it (for branching)",
      "x-ui-group": "Configuration",
    },
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const CacheCheckpointOutputSchema = {
  type: "object",
  properties: {
    checkpoint: {
      type: "string",
      format: "cache-checkpoint",
      title: "Checkpoint",
      description: "Handle to the warmed prompt-prefix cache",
    },
  },
  required: ["checkpoint"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type CacheCheckpointTaskInput = {
  model: string | ModelConfig;
  systemPrompt?: string | undefined;
  tools?: ToolDefinition[] | undefined;
  messages?: ChatMessage[] | undefined;
  checkpoint?: string | undefined;
  keepParent?: boolean | undefined;
};
export type CacheCheckpointTaskOutput = { checkpoint: string };
export type CacheCheckpointTaskConfig = TaskConfig<CacheCheckpointTaskInput>;

/**
 * Eagerly warms a prompt-prefix cache (provider prompt caching or local KV
 * state) and outputs an opaque checkpoint handle other AI tasks can start
 * from. The handle doubles as a provider session id. Lifecycle: the handle
 * lives for the duration of the run's ResourceScope and is auto-disposed at
 * run end. Within a run, an emitted chained checkpoint
 * supersedes its parent (disposing the parent's session and registry entry)
 * unless `keepParent` is set. To span multiple standalone runs, callers inject
 * a shared `resourceScope` via the run config so the handle survives across
 * each `.run()`.
 */
export class CacheCheckpointTask extends AiTask<
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  CacheCheckpointTaskConfig
> {
  public static override type = "CacheCheckpointTask";
  public static override readonly requires = ["cache.checkpoint"] as const satisfies Capability[];
  public static override category = "AI Text";
  public static override title = "Cache Checkpoint";
  public static override description =
    "Warms a prompt-prefix cache (system prompt, tools, messages) and outputs a checkpoint handle downstream AI tasks can start from";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return CacheCheckpointInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return CacheCheckpointOutputSchema as DataPortSchema;
  }

  private _checkpointId: string | undefined;
  private _mergedPrefix: CheckpointPrefix | undefined;
  private _parentId: string | undefined;

  private prepareCheckpoint(input: CacheCheckpointTaskInput, context: IExecuteContext): void {
    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new TaskConfigurationError(
        "CacheCheckpointTask: model was not resolved to ModelConfig"
      );
    }

    // Fail loudly if the model has no stable identity — a keyless mint is what
    // let cross-model contamination slip through the mismatch guard before.
    // Runs before validateParentCheckpoint / createSession so no session slot
    // gets minted when we would only reject on the way out.
    const modelKey = requireCheckpointModelKey(model, "CacheCheckpointTask");

    const parent: CheckpointEntry | undefined = input.checkpoint
      ? validateParentCheckpoint(input.checkpoint, model, "CacheCheckpointTask")
      : undefined;

    const prefix = mergeCheckpointPrefix(parent?.prefix, {
      systemPrompt: input.systemPrompt,
      tools: input.tools,
      messages: input.messages ?? [],
    });

    const registry = getAiProviderRegistry();
    const providerName = model.provider;
    const id = registry.createSession(providerName, model);
    registerCheckpoint(id, {
      provider: providerName,
      modelKey,
      prefix,
      ...(input.checkpoint ? { parentId: input.checkpoint } : {}),
    });

    if (context.resourceScope) {
      context.resourceScope.register(`ai:session:${id}`, async () => {
        await registry.disposeSession(providerName, id);
        deleteCheckpoint(id);
      });
    }

    this._checkpointId = id;
    this._mergedPrefix = prefix;
    this._parentId = input.checkpoint;
  }

  protected override async getJobInput(
    input: CacheCheckpointTaskInput
  ): Promise<AiJobInput<CacheCheckpointTaskInput>> {
    const jobInput = await super.getJobInput(input);
    if (this._checkpointId) {
      jobInput.session = { sessionId: this._checkpointId, prefix: this._mergedPrefix };
    }
    return jobInput;
  }

  override async execute(
    input: CacheCheckpointTaskInput,
    executeContext: IExecuteContext
  ): Promise<CacheCheckpointTaskOutput | undefined> {
    this.prepareCheckpoint(input, executeContext);
    await super.execute(input, executeContext);

    if (this._parentId && !input.keepParent) {
      const model = input.model as ModelConfig;
      try {
        await getAiProviderRegistry().disposeSession(model.provider, this._parentId);
      } catch {
        // Best-effort: a parent-dispose failure (worker restarted, transport
        // error) must not fail a warm-up that already succeeded. The parent's
        // scope disposer retries at run end and dispose is idempotent.
      }
      deleteCheckpoint(this._parentId);
    }

    // prepareCheckpoint either threw or set the id; a silent empty-string
    // handle would surface far away as "unknown cache checkpoint".
    if (!this._checkpointId) {
      throw new TaskConfigurationError("CacheCheckpointTask: checkpoint id missing after warm-up");
    }
    return { checkpoint: this._checkpointId };
  }
}

export const cacheCheckpoint = (
  input: CacheCheckpointTaskInput,
  config?: CacheCheckpointTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new CacheCheckpointTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    cacheCheckpoint: CreateWorkflow<
      CacheCheckpointTaskInput,
      CacheCheckpointTaskOutput,
      CacheCheckpointTaskConfig
    >;
  }
}

Workflow.prototype.cacheCheckpoint = CreateWorkflow(CacheCheckpointTask);
