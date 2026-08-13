/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getMcpServerConfig,
  getMcpServerTransport,
  getMcpTaskDeps,
  TypeMcpServer,
} from "@workglow/mcp/util";
import type {
  CachePolicy,
  IExecuteContext,
  IRunConfig,
  TaskConfig,
  TaskEntitlements,
} from "@workglow/task-graph";
import {
  CreateWorkflow,
  Entitlements,
  mergeEntitlements,
  Task,
  Workflow,
} from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const mcpListTypes = ["tools", "resources", "prompts"] as const;

const iconSchema = {
  type: "object",
  properties: {
    src: { type: "string" },
    mimeType: { type: "string" },
    sizes: { type: "array", items: { type: "string" } },
    theme: { type: "string", enum: ["light", "dark"] },
  },
  additionalProperties: false,
} as const;

const outputSchemaTools = {
  type: "object",
  properties: {
    tools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          inputSchema: {
            type: "object",
            properties: {
              type: { type: "string" },
              properties: { type: "object", additionalProperties: true },
              required: { type: "array", items: { type: "string" } },
            },
            additionalProperties: true,
          },
          outputSchema: {
            type: "object",
            properties: {
              type: { type: "string" },
              properties: { type: "object", additionalProperties: true },
              required: { type: "array", items: { type: "string" } },
            },
            additionalProperties: true,
          },
          annotations: {
            type: "object",
            properties: {
              title: { type: "string" },
              readOnlyHint: { type: "boolean" },
              destructiveHint: { type: "boolean" },
              idempotentHint: { type: "boolean" },
              openWorldHint: { type: "boolean" },
            },
            additionalProperties: false,
          },
          execution: {
            type: "object",
            properties: {
              taskSupport: {
                type: "string",
                enum: ["optional", "required", "forbidden"],
              },
            },
            additionalProperties: false,
          },
          _meta: { type: "object", additionalProperties: true },
          icons: { type: "array", items: iconSchema },
          title: { type: "string" },
        },
        required: ["name", "inputSchema"],
        additionalProperties: false,
      },
      title: "Tools",
      description: "The tools available on the MCP server",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchemaResources = {
  type: "object",
  properties: {
    resources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          uri: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          mimeType: { type: "string" },
          annotations: {
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
          },
          _meta: { type: "object", additionalProperties: true },
          icons: { type: "array", items: iconSchema },
          title: { type: "string" },
        },
        required: ["uri", "name"],
        additionalProperties: false,
      },
      title: "Resources",
      description: "The resources available on the MCP server",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchemaPrompts = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          arguments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                required: { type: "boolean" },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
          _meta: { type: "object", additionalProperties: true },
          icons: { type: "array", items: iconSchema },
          title: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      title: "Prompts",
      description: "The prompts available on the MCP server",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchemaAll = {
  type: "object",
  properties: {
    ...outputSchemaTools.properties,
    ...outputSchemaResources.properties,
    ...outputSchemaPrompts.properties,
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpListTaskOutput = FromSchema<typeof outputSchemaAll>;

/** MCP list input (transport + server config fields, plus task-specific fields like list_type). */
export type McpListTaskInput = Record<string, unknown>;

export class McpListTask extends Task<McpListTaskInput, McpListTaskOutput, TaskConfig> {
  public static override type = "McpListTask";
  public static override category = "MCP";
  public static override title = "MCP List";
  public static override description =
    "Lists tools, resources, or prompts available on an MCP server";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override hasDynamicSchemas: boolean = true;
  public static override hasDynamicEntitlements: boolean = true;

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [
        { id: Entitlements.MCP, reason: "Lists tools, resources, or prompts on MCP servers" },
      ],
    };
  }

  public override entitlements(): TaskEntitlements {
    const base = McpListTask.entitlements();
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

  public static override inputSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        server: TypeMcpServer(mcpServerConfigSchema),
        list_type: {
          type: "string",
          enum: mcpListTypes,
          title: "List Type",
          description: "The type of items to list from the MCP server",
        },
      },
      required: ["server", "list_type"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema() {
    return outputSchemaAll;
  }

  public override outputSchema(): DataPortSchema {
    const listType = this.runInputData?.list_type ?? this.defaults?.list_type ?? null;

    if (listType === null || listType === undefined) {
      return outputSchemaAll;
    }

    switch (listType) {
      case "tools":
        return outputSchemaTools;
      case "resources":
        return outputSchemaResources;
      case "prompts":
        return outputSchemaPrompts;
      default:
        return outputSchemaAll;
    }
  }

  public override setInput(input: Partial<McpListTaskInput>): void {
    if (!("list_type" in input)) {
      super.setInput(input);
      return;
    }

    const previousListType = this.runInputData?.list_type ?? this.defaults?.list_type ?? null;
    super.setInput(input);
    const newListType = this.runInputData?.list_type ?? this.defaults?.list_type ?? null;

    if (previousListType !== newListType) {
      this.emitSchemaChange();
    }
  }

  override async execute(
    input: McpListTaskInput,
    context: IExecuteContext
  ): Promise<McpListTaskOutput> {
    const serverConfig = getMcpServerConfig(input as Record<string, unknown>);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(
      serverConfig,
      context.signal,
      context.registry
    );
    const listType = input.list_type;
    try {
      switch (listType) {
        case "tools": {
          const result = await client.listTools();
          return { tools: result.tools };
        }
        case "resources": {
          const result = await client.listResources();
          return { resources: result.resources };
        }
        case "prompts": {
          const result = await client.listPrompts();
          return { prompts: result.prompts };
        }
        default:
          throw new Error(`Unsupported list type: ${String(listType)}`);
      }
    } finally {
      await client.close();
    }
  }
}

export const mcpList = async (
  input: McpListTaskInput,
  config: TaskConfig = {},
  runConfig: Partial<IRunConfig> = {}
): Promise<McpListTaskOutput> => {
  return new McpListTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpList: CreateWorkflow<McpListTaskInput, McpListTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.mcpList = CreateWorkflow(McpListTask);
