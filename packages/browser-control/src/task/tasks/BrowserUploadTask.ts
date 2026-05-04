/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Entitlements,
  IExecuteContext,
  Task,
  TaskConfig,
  TaskConfigSchema,
  TaskEntitlements,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserUploadTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserUploadTaskConfig = TaskConfig;

const inputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session to use",
    },
    ref: {
      type: "string",
      title: "Element Ref",
      description: "The file input element reference to upload to",
    },
    filePaths: {
      type: "array",
      items: {
        type: "string",
      },
      title: "File Paths",
      description: "The local file paths to upload",
    },
  },
  required: ["sessionId", "ref", "filePaths"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session ID",
    },
  },
  required: ["sessionId"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserUploadTaskInput = FromSchema<typeof inputSchema>;
export type BrowserUploadTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserUploadTask extends Task<
  BrowserUploadTaskInput,
  BrowserUploadTaskOutput,
  BrowserUploadTaskConfig
> {
  static override readonly type = "BrowserUploadTask";
  static override readonly category = "Browser";
  public static override title = "Browser Upload";
  public static override description =
    "Uploads one or more files to a file input element in the browser";
  static override readonly cacheable = false;

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [
        { id: Entitlements.FILESYSTEM_READ, reason: "Reads local files for upload to browser" },
      ],
    };
  }

  public static override configSchema(): DataPortSchema {
    return browserUploadTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserUploadTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserUploadTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.uploadFile(input.ref, input.filePaths);
    return { sessionId: input.sessionId };
  }
}
