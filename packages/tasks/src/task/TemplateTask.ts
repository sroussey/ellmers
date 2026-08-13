/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_match, expr: string) => {
    const [path, defaultValue] = expr.split("|").map((s: string) => s.trim());
    const segments = path.split(".");
    let current: unknown = values;
    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (current !== undefined && current !== null) {
      return String(current);
    }
    return defaultValue !== undefined ? defaultValue : "";
  });
}

const inputSchema = {
  type: "object",
  properties: {
    template: {
      type: "string",
      title: "Template",
      description:
        "Template string with {{key}} placeholders; supports {{key|default}} for defaults",
    },
    values: {
      type: "object",
      title: "Values",
      description: "Key-value pairs to substitute into the template",
      additionalProperties: true,
    },
  },
  required: ["template", "values"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "Rendered template string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TemplateTaskInput = FromSchema<typeof inputSchema>;
export type TemplateTaskOutput = FromSchema<typeof outputSchema>;

/**
 * TemplateTask renders a template string by replacing `{{key}}` placeholders
 * with corresponding values. Supports `{{key|default}}` syntax for fallback
 * values when a key is missing. Nested dot-notation paths (e.g. `{{a.b}}`)
 * are resolved against the values object.
 */
export class TemplateTask<
  Input extends TemplateTaskInput = TemplateTaskInput,
  Output extends TemplateTaskOutput = TemplateTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "TemplateTask";
  static override readonly category = "Utility";
  public static override title = "Template";
  public static override description =
    "Renders a template string with {{key}} placeholders and optional defaults";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { result: renderTemplate(input.template, input.values) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { result: renderTemplate(input.template, input.values) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    template: CreateWorkflow<TemplateTaskInput, TemplateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.template = CreateWorkflow(TemplateTask);
