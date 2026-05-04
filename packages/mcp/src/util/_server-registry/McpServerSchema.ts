/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, FromSchema } from "@workglow/util/schema";
import { mcpServerConfigSchema } from "../McpClientUtil";
import { mcpServerRecordMetadataProperties } from "./mcpServerReferenceObjectSchema";

export const McpServerRecordSchema = {
  type: "object",
  properties: {
    ...mcpServerRecordMetadataProperties,
    ...mcpServerConfigSchema.properties,
  },
  required: ["server_id", "transport"],
  allOf: mcpServerConfigSchema.allOf,
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type McpServerRecord = FromSchema<typeof McpServerRecordSchema>;
export const McpServerPrimaryKeyNames = ["server_id"] as const;
