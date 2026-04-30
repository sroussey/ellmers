/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, getTaskConstructors, Workflow } from "@workglow/task-graph";

import type { IExecuteContext, StreamEvent, TaskConfig } from "@workglow/task-graph";
import { makeFingerprint, ServiceRegistry } from "@workglow/util";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";
import type { ChatMessage } from "./ChatMessage";
import { ChatMessageSchema } from "./ChatMessage";
import type { ToolDefinition } from "./ToolCallingUtils";

// ========================================================================
// Utility: convert TaskRegistry entries to tool definitions
// ========================================================================

export interface ToolDefinitionWithTaskType extends ToolDefinition {
  /** The task type name this definition was generated from. */
  readonly taskType: string;
}

/**
 * Converts an allow-list of task type names into {@link ToolDefinitionWithTaskType} objects
 * suitable for the ToolCallingTask input. Each entry carries the originating
 * `taskType` so callers don't need to rely on index correspondence.
 *
 * Each task's `type`, `description`, `inputSchema()`, and `outputSchema()`
 * are used to build the tool definition.
 *
 * @param taskNames - Array of task type names registered in the task constructors
 * @param registry - Optional service registry for DI-based lookups
 * @returns Array of ToolDefinitionWithTaskType objects
 * @throws Error if a task name is not found in the registry
 */
export function taskTypesToTools(
  taskNames: ReadonlyArray<string>,
  registry?: ServiceRegistry
): ToolDefinitionWithTaskType[] {
  const constructors = getTaskConstructors(registry);
  return taskNames.map((name) => {
    const ctor = constructors.get(name);
    if (!ctor) {
      throw new Error(
        `taskTypesToTools: Unknown task type "${name}" — not found in task constructors registry (ServiceRegistry: ${registry ? "custom" : "default"})`
      );
    }
    const configSchema =
      "configSchema" in ctor && typeof ctor.configSchema === "function"
        ? ctor.configSchema()
        : undefined;
    return {
      name: ctor.type,
      description: ctor.description ?? "",
      inputSchema: ctor.inputSchema(),
      outputSchema: ctor.outputSchema(),
      ...(configSchema ? { configSchema } : {}),
      taskType: name,
    };
  });
}

// ========================================================================
// Schemas
// ========================================================================

export const ToolDefinitionSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      title: "Name",
      description: "The tool name",
    },
    description: {
      type: "string",
      title: "Description",
      description: "A description of what the tool does",
    },
    inputSchema: {
      type: "object",
      title: "Input Schema",
      description: "JSON Schema describing the tool's input parameters",
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      title: "Output Schema",
      description: "JSON Schema describing what the tool returns",
      additionalProperties: true,
    },
    configSchema: {
      type: "object",
      title: "Config Schema",
      description: "JSON Schema describing the task's configuration options (not sent to the LLM)",
      additionalProperties: true,
    },
    config: {
      type: "object",
      title: "Config",
      description: "Concrete configuration values for the backing task (not sent to the LLM)",
      additionalProperties: true,
    },
  },
  required: ["name", "description", "inputSchema"],
  additionalProperties: true,
} as const;

const ToolCallSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      title: "ID",
      description: "Unique identifier for this tool call",
    },
    name: {
      type: "string",
      title: "Name",
      description: "The name of the tool to invoke",
    },
    input: {
      type: "object",
      title: "Input",
      description: "The input arguments for the tool call",
      additionalProperties: true,
    },
  },
  required: ["id", "name", "input"],
  additionalProperties: false,
} as const;

const modelSchema = TypeModel("model:ToolCallingTask");

export const ToolCallingInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      oneOf: [
        { type: "string", title: "Prompt", description: "The prompt to send to the model" },
        {
          type: "array",
          title: "Prompt",
          description: "The prompt as an array of strings or content blocks",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["text", "image", "audio"] },
                },
                required: ["type"],
                additionalProperties: true,
              },
            ],
          },
        },
      ],
      title: "Prompt",
      description: "The prompt to send to the model",
    },
    systemPrompt: {
      type: "string",
      title: "System Prompt",
      description: "Optional system instructions for the model",
    },
    messages: {
      type: "array",
      title: "Messages",
      description:
        "Full conversation history for multi-turn interactions. When provided, used instead of prompt to construct the messages array sent to the provider.",
      items: ChatMessageSchema,
    },
    tools: {
      type: "array",
      format: "tasks",
      title: "Tools",
      description: "Tool definitions available for the model to call",
      items: {
        oneOf: [
          { type: "string", format: "tasks", description: "Task type name" },
          ToolDefinitionSchema,
        ],
      },
    },
    toolChoice: {
      type: "string",
      title: "Tool Choice",
      description:
        'Controls tool selection: "auto" (model decides), "none" (no tools), "required" (must call a tool), or a specific tool name',
      "x-ui-group": "Configuration",
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "The maximum number of tokens to generate",
      minimum: 1,
      "x-ui-group": "Configuration",
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "The temperature to use for sampling",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt", "tools"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ToolCallingOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Any text content generated by the model",
      "x-stream": "append",
    },
    toolCalls: {
      type: "array",
      items: ToolCallSchema,
      title: "Tool Calls",
      description: "Tool calls requested by the model",
      "x-stream": "object",
    },
  },
  required: ["text", "toolCalls"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Runtime input type for ToolCallingTask.
 *
 * The schema uses `oneOf: [string, object]` so the UI can accept both task-name
 * references and inline tool definitions, but the input resolver converts all
 * strings to {@link ToolDefinition} objects before execution. The `tools` field
 * is therefore narrowed to `ToolDefinition[]` here.
 *
 * Extends the schema-derived base with the
 * `messages` field typed explicitly (the loose `content: {}` in the
 * schema prevents `FromSchema` from producing a useful type).
 */
export type ToolCallingTaskInput = Omit<
  FromSchema<typeof ToolCallingInputSchema>,
  "tools" | "messages"
> & {
  readonly tools: ToolDefinition[];
  readonly messages?: ReadonlyArray<ChatMessage>;
  readonly sessionId?: string;
};

export type ToolCallingTaskOutput = FromSchema<typeof ToolCallingOutputSchema>;
export type ToolCallingTaskConfig = TaskConfig<ToolCallingTaskInput>;

// ========================================================================
// Task class
// ========================================================================

export class ToolCallingTask extends StreamingAiTask<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCallingTaskConfig
> {
  public static override type = "ToolCallingTask";
  public static override category = "AI Text";
  public static override title = "Tool Calling";
  public static override description =
    "Sends a prompt with tool definitions to a language model and returns text along with any tool calls the model requests";
  public static override inputSchema(): DataPortSchema {
    return ToolCallingInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ToolCallingOutputSchema as DataPortSchema;
  }

  /** Session ID computed during getJobInput, used to register cleanup. */
  private _computedSessionId: string | undefined;

  /**
   * Override to auto-compute a prefix-rewind session ID from tools + systemPrompt
   * + runnerId when no explicit sessionId is provided. The runnerId scopes the
   * cache to the current graph run so it's cleaned up via ResourceScope.
   */
  protected override async getJobInput(
    input: ToolCallingTaskInput
  ): Promise<AiJobInput<ToolCallingTaskInput>> {
    const jobInput = await super.getJobInput(input);

    if (!jobInput.sessionId && input.tools && input.tools.length > 0) {
      jobInput.sessionId = await makeFingerprint({
        tools: input.tools,
        systemPrompt: input.systemPrompt,
        runnerId: this.runConfig.runnerId,
      });
      this._computedSessionId = jobInput.sessionId;
    }

    return jobInput;
  }

  private registerSessionDispose(input: ToolCallingTaskInput, context: IExecuteContext): void {
    const sessionId = this._computedSessionId;
    if (!sessionId || !context.resourceScope) return;

    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") return;

    const providerName = model.provider;
    context.resourceScope.register(`ai:session:${sessionId}`, async () => {
      await getAiProviderRegistry().disposeSession(providerName, sessionId);
    });
  }

  override async execute(
    input: ToolCallingTaskInput,
    executeContext: IExecuteContext
  ): Promise<ToolCallingTaskOutput | undefined> {
    const result = await super.execute(input, executeContext);
    this.registerSessionDispose(input, executeContext);
    return result;
  }

  override async *executeStream(
    input: ToolCallingTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
    yield* super.executeStream(input, context);
    this.registerSessionDispose(input, context);
  }
}

/**
 * Convenience function to run a tool calling task.
 */
export const toolCalling = (input: ToolCallingTaskInput, config?: ToolCallingTaskConfig) => {
  return new ToolCallingTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    toolCalling: CreateWorkflow<ToolCallingTaskInput, ToolCallingTaskOutput, ToolCallingTaskConfig>;
  }
}

Workflow.prototype.toolCalling = CreateWorkflow(ToolCallingTask);
