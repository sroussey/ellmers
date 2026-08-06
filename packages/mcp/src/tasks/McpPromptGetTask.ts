/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpServerConfig } from "@workglow/mcp/util";
import {
  getMcpServerConfig,
  getMcpServerTransport,
  getMcpTaskDeps,
  TypeMcpServer,
} from "@workglow/mcp/util";
import type {
  CachePolicy,
  IExecuteContext,
  TaskConfig,
  TaskEntitlements,
} from "@workglow/task-graph";
import {
  CreateWorkflow,
  Entitlements,
  mergeEntitlements,
  Task,
  TaskConfigSchema,
  Workflow,
} from "@workglow/task-graph";
import type { ServiceRegistry } from "@workglow/util";
import type { DataPortSchema, DataPortSchemaObject, FromSchema } from "@workglow/util/schema";
import type { McpListTaskInput } from "./McpListTask";
import { mcpList } from "./McpListTask";

const annotationsSchema = {
  type: "object",
  properties: {
    audience: {
      type: "array",
      items: { type: "string", enum: ["user", "assistant"] },
    },
    priority: { type: "number" },
    lastModified: { type: "string" },
  },
  additionalProperties: false,
} as const;

const contentSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "text" },
        text: { type: "string" },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "image" },
        data: { type: "string" },
        mimeType: { type: "string" },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "data", "mimeType"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "audio" },
        data: { type: "string" },
        mimeType: { type: "string" },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "data", "mimeType"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "resource" },
        resource: {
          type: "object",
          properties: {
            uri: { type: "string" },
            text: { type: "string" },
            blob: { type: "string" },
            mimeType: { type: "string" },
            _meta: { type: "object", additionalProperties: true },
          },
          required: ["uri"],
          additionalProperties: false,
        },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "resource"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "resource_link" },
        uri: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        mimeType: { type: "string" },
        annotations: annotationsSchema,
        icons: {
          type: "array",
          items: {
            type: "object",
            properties: {
              src: { type: "string" },
              mimeType: { type: "string" },
              sizes: { type: "array", items: { type: "string" } },
              theme: { type: "string", enum: ["light", "dark"] },
            },
            additionalProperties: false,
          },
        },
        title: { type: "string" },
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "uri", "name"],
      additionalProperties: false,
    },
  ],
} as const;

const fallbackOutputSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["user", "assistant"] },
          content: contentSchema,
        },
        required: ["role", "content"],
        additionalProperties: false,
      },
      title: "Messages",
      description: "The messages returned by the prompt",
    },
    description: {
      type: "string",
      title: "Description",
      description: "The description of the prompt",
    },
  },
  required: ["messages"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const fallbackInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpPromptGetTaskConfig = TaskConfig & Record<string, unknown>;
export type McpPromptGetTaskInput = Record<string, unknown>;
export type McpPromptGetTaskOutput = FromSchema<typeof fallbackOutputSchema>;

export class McpPromptGetTask extends Task<
  McpPromptGetTaskInput,
  McpPromptGetTaskOutput,
  McpPromptGetTaskConfig
> {
  public static override type = "McpPromptGetTask";
  public static override category = "MCP";
  public static override title = "MCP Get Prompt";
  public static override description = "Gets a prompt from an MCP server";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override customizable = true;
  public static override hasDynamicSchemas = true;
  public static override hasDynamicEntitlements: boolean = true;

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [{ id: Entitlements.MCP_PROMPT_GET, reason: "Gets prompts from MCP servers" }],
    };
  }

  public override entitlements(): TaskEntitlements {
    const base = McpPromptGetTask.entitlements();
    const transport = getMcpServerTransport(this);
    if (transport === "stdio") {
      return mergeEntitlements(base, {
        entitlements: [
          { id: Entitlements.MCP_STDIO, reason: "Uses stdio transport to spawn local process" },
        ],
      });
    }
    return mergeEntitlements(base, {
      entitlements: [
        { id: Entitlements.NETWORK_HTTP, reason: "Connects to MCP server over HTTP" },
        { id: Entitlements.CREDENTIAL, reason: "May require authentication", optional: true },
      ],
    });
  }

  public static override inputSchema() {
    return fallbackInputSchema;
  }

  public static override outputSchema() {
    return fallbackOutputSchema;
  }

  public static override configSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        ...TaskConfigSchema["properties"],
        server: TypeMcpServer(mcpServerConfigSchema),
        prompt_name: {
          type: "string",
          title: "Prompt Name",
          description: "The name of the prompt to get",
          format: "string:mcp-promptname",
        },
      },
      required: ["server", "prompt_name"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public override inputSchema(): DataPortSchema {
    return this.config?.inputSchema ?? fallbackInputSchema;
  }

  public override outputSchema(): DataPortSchema {
    return this.config?.outputSchema ?? fallbackOutputSchema;
  }

  private _schemasDiscoveringPromise: Promise<void> | undefined;

  async discoverSchemas(
    _signal?: AbortSignal,
    serverConfig?: McpServerConfig,
    registry?: ServiceRegistry
  ): Promise<void> {
    if (this.config.inputSchema) return;
    if (this._schemasDiscoveringPromise) return this._schemasDiscoveringPromise;
    const resolved = serverConfig ?? getMcpServerConfig(this.config as Record<string, unknown>);
    if (!resolved.transport || !this.config.prompt_name) return;

    this._schemasDiscoveringPromise = (async () => {
      try {
        const result = await mcpList(
          {
            server: resolved,
            list_type: "prompts",
          } as McpListTaskInput,
          {},
          registry ? { registry } : {}
        );

        const prompt = result.prompts?.find((p) => p.name === this.config.prompt_name);
        if (prompt) {
          const args = prompt.arguments ?? [];
          const required = args.filter((a) => a.required).map((a) => a.name);
          const properties: DataPortSchemaObject["properties"] = {};
          for (const arg of args) {
            properties[arg.name] = {
              type: "string",
              ...(arg.description ? { description: arg.description } : {}),
            };
          }
          this.config.inputSchema = {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
            additionalProperties: false,
          };

          this.emitSchemaChange();
        }
      } finally {
        this._schemasDiscoveringPromise = undefined;
      }
    })();
    return this._schemasDiscoveringPromise;
  }

  override async execute(
    input: McpPromptGetTaskInput,
    context: IExecuteContext
  ): Promise<McpPromptGetTaskOutput> {
    const serverConfig = getMcpServerConfig(this.config as Record<string, unknown>);

    await this.discoverSchemas(context.signal, serverConfig, context.registry);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(
      serverConfig,
      context.signal,
      context.registry
    );
    try {
      const result = await client.getPrompt({
        name: String(this.config.prompt_name ?? ""),
        arguments: input as Record<string, string>,
      });
      return {
        messages: result.messages,
        description: result.description,
      };
    } finally {
      await client.close();
    }
  }
}

export const mcpPromptGet = async (
  input: McpPromptGetTaskInput,
  config: McpPromptGetTaskConfig
): Promise<McpPromptGetTaskOutput> => {
  return new McpPromptGetTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpPromptGet: CreateWorkflow<
      McpPromptGetTaskInput,
      McpPromptGetTaskOutput,
      McpPromptGetTaskConfig
    >;
  }
}

Workflow.prototype.mcpPromptGet = CreateWorkflow(McpPromptGetTask);
