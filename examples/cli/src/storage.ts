/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { ModelPrimaryKeyNames, ModelRecordSchema, ModelRepository } from "@workglow/ai";
import { mcpServerConfigSchema } from "@workglow/mcp/util";
import { FsFolderTabularStorage } from "@workglow/storage";
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import type { CliConfig } from "./config";

export const McpServerRecordSchema = {
  type: "object",
  properties: {
    name: { type: "string", "x-auto-generated": false },
    ...mcpServerConfigSchema.properties,
  },
  required: ["name", "transport", "auth_type"],
  allOf: [...mcpServerConfigSchema.allOf],
} as const;

export const McpServerPrimaryKeyNames = ["name"] as const;

export function createModelRepository(config: CliConfig): ModelRepository {
  const storage = new FsFolderTabularStorage<
    typeof ModelRecordSchema,
    typeof ModelPrimaryKeyNames,
    ModelRecord
  >(config.directories.models, ModelRecordSchema, ModelPrimaryKeyNames);
  return new ModelRepository(storage);
}

export function createWorkflowRepository(config: CliConfig): TaskGraphTabularRepository {
  return new TaskGraphTabularRepository({
    tabularRepository: new FsFolderTabularStorage(
      config.directories.workflows,
      TaskGraphSchema,
      TaskGraphPrimaryKeyNames
    ),
  });
}

export function createAgentRepository(config: CliConfig): TaskGraphTabularRepository {
  return new TaskGraphTabularRepository({
    tabularRepository: new FsFolderTabularStorage(
      config.directories.agents,
      TaskGraphSchema,
      TaskGraphPrimaryKeyNames
    ),
  });
}

export function createMcpStorage(
  config: CliConfig
): FsFolderTabularStorage<typeof McpServerRecordSchema, typeof McpServerPrimaryKeyNames> {
  return new FsFolderTabularStorage(
    config.directories.mcps,
    McpServerRecordSchema,
    McpServerPrimaryKeyNames
  );
}
