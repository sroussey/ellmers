/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, TaskConfig } from "@workglow/task-graph";
import {
  CreateWorkflow,
  Task,
  TaskAbortedError,
  TaskConfigSchema,
  TaskConfigurationError,
  Workflow,
} from "@workglow/task-graph";
import type {
  HumanInteractionKind,
  HumanResponseAction,
  IHumanRequest,
  IHumanResponse,
} from "@workglow/util";
import { resolveHumanConnector, uuid4 } from "@workglow/util";
import type { DataPortSchema, PropertySchema } from "@workglow/util/schema";

const humanInputTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    targetHumanId: {
      type: "string",
      title: "Target Human",
      description: "Identifier of the human to ask (e.g. 'default', 'admin', 'user:alice')",
      default: "default",
    },
    kind: {
      type: "string",
      title: "Kind",
      description:
        "Interaction kind: notify (one-way), display (show content), elicit (request input)",
      enum: ["notify", "display", "elicit"],
      default: "elicit",
    },
    contentSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
      title: "Content Schema",
      description: "JSON schema describing the content/form to present",
      "x-ui-hidden": true,
    },
    message: {
      type: "string",
      title: "Message",
      description: "Explanatory message shown to the human",
      "x-ui-editor": "textarea",
    },
    mode: {
      type: "string",
      title: "Mode",
      description: "Interaction mode",
      enum: ["single", "multi-turn"],
      default: "single",
    },
    metadata: {
      type: "object",
      additionalProperties: true,
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HumanInputTaskConfig = TaskConfig & {
  /** Target human identifier — defaults to "default" */
  targetHumanId?: string;
  /** Interaction kind — defaults to "elicit" */
  kind?: HumanInteractionKind;
  /** JSON schema describing the content/form to render */
  contentSchema?: DataPortSchema;
  /** Explanatory message */
  message?: string;
  /** Interaction mode — defaults to "single" */
  mode?: "single" | "multi-turn";
  /** Arbitrary metadata passed to the connector */
  metadata?: Record<string, unknown>;
};

const defaultInputSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Dynamic prompt text merged into the request message",
    },
    contentData: {
      type: "object",
      additionalProperties: true,
      title: "Content Data",
      description: "Data to display (for notify/display kinds)",
      "x-ui-hidden": true,
    },
    context: {
      type: "object",
      additionalProperties: true,
      title: "Context",
      description: "Dynamic context data merged into the request metadata",
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const defaultOutputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      title: "Action",
      description: "The human's action: accept, decline, or cancel",
      enum: ["accept", "decline", "cancel"],
    },
  },
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type HumanInputTaskInput = {
  prompt?: string;
  contentData?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type HumanInputTaskOutput = {
  /** The human's action */
  action: HumanResponseAction;
  /** Additional response data (for elicit kind) */
  [key: string]: unknown;
};

/**
 * A task that sends an interaction to a human via an IHumanConnector.
 *
 * Supports three interaction kinds:
 * - "notify": Send a notification (fire-and-forget, task completes immediately)
 * - "display": Present content to the human (charts, data, markdown)
 * - "elicit": Request structured input via a form (MCP elicitation model)
 *
 * The contentSchema describes WHAT to render. The kind determines HOW.
 * For "elicit", the output includes the human's submitted data.
 * For "notify"/"display", the output is just `{ action: "accept" }`.
 */
export class HumanInputTask extends Task<
  HumanInputTaskInput,
  HumanInputTaskOutput,
  HumanInputTaskConfig
> {
  static override readonly type = "HumanInputTask";
  static override readonly category = "Flow Control";
  public static override title = "Human Input";
  public static override description =
    "Sends an interaction (notification, display, or input request) to a human";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override hasDynamicSchemas = true;

  public static override configSchema(): DataPortSchema {
    return humanInputTaskConfigSchema;
  }

  static override inputSchema(): DataPortSchema {
    return defaultInputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return defaultOutputSchema;
  }

  public override outputSchema(): DataPortSchema {
    if (this.config?.contentSchema && (this.config.kind ?? "elicit") === "elicit") {
      const configSchema = this.config.contentSchema as Record<string, unknown>;
      const existingProps = (configSchema.properties ?? {}) as Record<string, unknown>;
      const additionalProperties = configSchema.additionalProperties ?? false;
      const actionProp = {
        type: "string",
        title: "Action",
        description: "The human's action: accept, decline, or cancel",
        enum: ["accept", "decline", "cancel"],
      } as const satisfies PropertySchema;
      const result = {
        type: "object",
        properties: { ...existingProps, action: actionProp },
        required: ["action"],
        additionalProperties,
      } as const satisfies DataPortSchema;
      return result;
    }
    return (this.constructor as typeof HumanInputTask).outputSchema();
  }

  override async execute(
    input: HumanInputTaskInput,
    context: IExecuteContext
  ): Promise<HumanInputTaskOutput> {
    const connector = resolveHumanConnector(context);
    const kind = this.config.kind ?? "elicit";
    const mode = this.config.mode ?? "single";
    const requestId = uuid4();

    const message = input.prompt
      ? this.config.message
        ? `${this.config.message}\n\n${input.prompt}`
        : input.prompt
      : (this.config.message ?? "");

    const emptySchema: DataPortSchema = {
      type: "object",
      properties: {},
      additionalProperties: true,
    };

    const request: IHumanRequest = {
      requestId,
      targetHumanId: this.config.targetHumanId ?? "default",
      kind,
      message,
      contentSchema: this.config.contentSchema ?? emptySchema,
      contentData: input.contentData,
      expectsResponse: kind === "elicit",
      mode: kind === "elicit" ? mode : "single",
      metadata: input.context
        ? { ...this.config.metadata, ...input.context }
        : this.config.metadata,
    };

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted before sending human interaction");
    }

    let response: IHumanResponse;
    try {
      response = await connector.send(request, context.signal);
    } catch (err) {
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted during human interaction");
      }
      throw err;
    }

    if (kind === "elicit" && mode === "multi-turn" && !response.done) {
      if (typeof connector.followUp !== "function") {
        throw new TaskConfigurationError(
          'HumanInputTask is configured for "multi-turn" mode but the registered ' +
            "IHumanConnector does not implement followUp()"
        );
      }

      while (!response.done) {
        if (context.signal.aborted) {
          throw new TaskAbortedError("Task aborted during multi-turn conversation");
        }
        try {
          response = await connector.followUp(request, response, context.signal);
        } catch (err) {
          if (context.signal.aborted) {
            throw new TaskAbortedError("Task aborted during multi-turn conversation");
          }
          throw err;
        }
      }
    }

    return { ...response.content, action: response.action };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    humanInput: CreateWorkflow<HumanInputTaskInput, HumanInputTaskOutput, HumanInputTaskConfig>;
  }
}

Workflow.prototype.humanInput = CreateWorkflow(HumanInputTask);
