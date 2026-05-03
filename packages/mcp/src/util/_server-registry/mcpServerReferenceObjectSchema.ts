/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Builds the JSON Schema for the `server` object in MCP task config/input schemas.
 * Uses the platform-injected {@link McpTaskDeps.mcpServerConfigSchema} so browser
 * builds get the correct (stdio-free) transport enum.
 */

import type { DataPortSchemaObject, JsonSchema } from "@workglow/util/schema";
import type { McpTaskDeps } from "../McpTaskDeps";

/** Optional fields from {@link McpServerRecordSchema} not present on {@link mcpServerConfigSchema}. */
export const mcpServerRecordMetadataProperties = {
  server_id: {
    type: "string",
    title: "Server ID",
    description:
      "MCP server repository id; present when the server reference was resolved from the registry",
  },
  label: {
    type: "string",
    title: "Label",
    description: "Display label for the server (optional)",
  },
  description: {
    type: "string",
    title: "Description",
    description: "Optional human-readable description",
  },
} as const satisfies DataPortSchemaObject["properties"];

/**
 * Builds the complete `server` oneOf schema for MCP task config/input schemas.
 *
 * Accepts the platform-injected `mcpServerConfigSchema` so that the transport
 * enum and conditional validation rules match the current runtime.
 */
export function TypeMcpServer(
  mcpServerConfigSchema: McpTaskDeps["mcpServerConfigSchema"]
): JsonSchema {
  return {
    oneOf: [
      { type: "string", format: "mcp-server" },
      {
        type: "object",
        format: "mcp-server",
        properties: {
          ...mcpServerConfigSchema.properties,
          ...mcpServerRecordMetadataProperties,
        },
        required: ["transport"],
        allOf: mcpServerConfigSchema.allOf,
        additionalProperties: false,
      },
    ],
    title: "Server",
    description: "MCP server reference (ID or inline config)",
  } as const;
}
