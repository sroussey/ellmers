/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, TaskConfig } from "@workglow/task-graph";
import {
  CreateWorkflow,
  Task,
  TaskAbortedError,
  TaskConfigSchema,
  Workflow,
} from "@workglow/task-graph";
import type { HumanResponseAction, IHumanRequest } from "@workglow/util";
import { resolveHumanConnector, uuid4 } from "@workglow/util";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const humanApprovalConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    targetHumanId: {
      type: "string",
      title: "Target Human",
      description: "Identifier of the human to ask for approval",
      default: "default",
    },
    message: {
      type: "string",
      title: "Message",
      description: "Explanatory message shown to the approver",
      "x-ui-editor": "textarea",
    },
    metadata: {
      type: "object",
      additionalProperties: true,
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HumanApprovalTaskConfig = TaskConfig & {
  /** Target human identifier — defaults to "default" */
  targetHumanId?: string;
  /** Explanatory message */
  message?: string;
  /** Arbitrary metadata passed to the connector */
  metadata?: Record<string, unknown>;
};

const inputSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Dynamic prompt text merged into the approval message",
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

const approvalRequestedSchema = {
  type: "object",
  properties: {
    approved: {
      type: "boolean",
      title: "Approved",
      description: "Whether the request is approved",
    },
    reason: {
      type: "string",
      title: "Reason",
      description: "Optional explanation for the decision",
    },
  },
  required: ["approved"],
} as const satisfies DataPortSchema;

const approvalOutputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      title: "Action",
      description: "The human's action: accept, decline, or cancel",
      enum: ["accept", "decline", "cancel"],
    },
    approved: {
      type: "boolean",
      title: "Approved",
      description: "Whether the human approved the request",
    },
    reason: {
      type: "string",
      title: "Reason",
      description: "Optional explanation for the decision",
    },
  },
  required: ["action", "approved"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HumanApprovalTaskInput = FromSchema<typeof inputSchema>;

export type HumanApprovalTaskOutput = {
  readonly action: HumanResponseAction;
  readonly approved: boolean;
  readonly reason?: string;
};

/**
 * Convenience task for the common approve/deny pattern.
 *
 * Presents the human with an approval dialog via MCP elicitation and returns
 * `{ action, approved, reason }`. Uses "single" mode — one question, one answer.
 *
 * If the human declines or cancels at the MCP level, `approved` is false and
 * `action` reflects the specific choice.
 */
export class HumanApprovalTask extends Task<
  HumanApprovalTaskInput,
  HumanApprovalTaskOutput,
  HumanApprovalTaskConfig
> {
  static override readonly type = "HumanApprovalTask";
  static override readonly category = "Flow Control";
  public static override title = "Human Approval";
  public static override description =
    "Pauses execution to request approval from a human (approve/deny) via MCP elicitation";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override configSchema(): DataPortSchema {
    return humanApprovalConfigSchema;
  }

  static override inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return approvalOutputSchema;
  }

  override async execute(
    input: HumanApprovalTaskInput,
    context: IExecuteContext
  ): Promise<HumanApprovalTaskOutput> {
    const connector = resolveHumanConnector(context);
    const requestId = uuid4();

    const message = input.prompt
      ? this.config.message
        ? `${this.config.message}\n\n${input.prompt}`
        : input.prompt
      : (this.config.message ?? "");

    const request: IHumanRequest = {
      requestId,
      targetHumanId: this.config.targetHumanId ?? "default",
      kind: "elicit",
      message,
      contentSchema: approvalRequestedSchema,
      contentData: undefined,
      expectsResponse: true,
      mode: "single",
      metadata: input.context
        ? { ...this.config.metadata, ...input.context }
        : this.config.metadata,
    };

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted before requesting human approval");
    }

    let response: Awaited<ReturnType<typeof connector.send>>;
    try {
      response = await connector.send(request, context.signal);
    } catch (err) {
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted during human approval");
      }
      throw err;
    }

    // Map MCP actions to approval semantics: "accept" with approved field from
    // content; "decline" or "cancel" → approved = false.
    if (response.action === "accept" && response.content) {
      return {
        action: response.action,
        approved: response.content.approved === true,
        reason: response.content.reason as string | undefined,
      };
    }

    return {
      action: response.action,
      approved: false,
      ...(response.content?.reason !== undefined
        ? { reason: response.content.reason as string }
        : {}),
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    humanApproval: CreateWorkflow<
      HumanApprovalTaskInput,
      HumanApprovalTaskOutput,
      HumanApprovalTaskConfig
    >;
  }
}

Workflow.prototype.humanApproval = CreateWorkflow(HumanApprovalTask);
