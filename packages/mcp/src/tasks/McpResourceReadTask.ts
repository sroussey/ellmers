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
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const contentItemSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        uri: { type: "string" },
        text: { type: "string" },
        mimeType: { type: "string" },
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["uri", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        uri: { type: "string" },
        blob: { type: "string" },
        mimeType: { type: "string" },
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["uri", "blob"],
      additionalProperties: false,
    },
  ],
} as const;

const inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    contents: {
      type: "array",
      items: contentItemSchema,
      title: "Contents",
      description: "The contents of the resource",
    },
  },
  required: ["contents"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpResourceReadTaskConfig = TaskConfig & Record<string, unknown>;
export type McpResourceReadTaskInput = FromSchema<typeof inputSchema>;
export type McpResourceReadTaskOutput = FromSchema<typeof outputSchema>;

export class McpResourceReadTask extends Task<
  McpResourceReadTaskInput,
  McpResourceReadTaskOutput,
  McpResourceReadTaskConfig
> {
  public static override type = "McpResourceReadTask";
  public static override category = "MCP";
  public static override title = "MCP Read Resource";
  public static override description = "Reads a resource from an MCP server";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override customizable = true;
  public static override hasDynamicEntitlements: boolean = true;

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [
        { id: Entitlements.MCP_RESOURCE_READ, reason: "Reads resources from MCP servers" },
      ],
    };
  }

  public override entitlements(): TaskEntitlements {
    const base = McpResourceReadTask.entitlements();
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
    return inputSchema;
  }

  public static override outputSchema() {
    return outputSchema;
  }

  public static override configSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        ...TaskConfigSchema["properties"],
        server: TypeMcpServer(mcpServerConfigSchema),
        resource_uri: {
          type: "string",
          title: "Resource URI",
          description: "The URI of the resource to read",
          format: "string:uri:mcp-resourceuri",
        },
      },
      required: ["server", "resource_uri"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    _input: McpResourceReadTaskInput,
    context: IExecuteContext
  ): Promise<McpResourceReadTaskOutput> {
    const serverConfig = getMcpServerConfig(this.config as Record<string, unknown>);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(
      serverConfig,
      context.signal,
      context.registry
    );
    try {
      const result = await client.readResource({
        uri: String(this.config.resource_uri ?? ""),
      });
      return { contents: result.contents };
    } finally {
      await client.close();
    }
  }
}

export const mcpResourceRead = async (
  config: McpResourceReadTaskConfig
): Promise<McpResourceReadTaskOutput> => {
  return new McpResourceReadTask(config).run({});
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpResourceRead: CreateWorkflow<
      McpResourceReadTaskInput,
      McpResourceReadTaskOutput,
      McpResourceReadTaskConfig
    >;
  }
}

Workflow.prototype.mcpResourceRead = CreateWorkflow(McpResourceReadTask);
