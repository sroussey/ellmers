/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IRunConfig, StreamEvent, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, TaskConfigurationError, TaskError, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema, SchemaNode } from "@workglow/util/schema";
import { compileSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const modelSchema = TypeModel("model:StructuredGenerationTask");

export const StructuredGenerationInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to generate structured output from",
    },
    outputSchema: {
      type: "object",
      title: "Output Schema",
      description: "JSON Schema describing the desired output structure",
      additionalProperties: true,
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "The maximum number of tokens to generate",
      minimum: 1,
      maximum: 4096,
      "x-ui-group": "Configuration",
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "The temperature to use for sampling",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
    maxRetries: {
      type: "integer",
      title: "Max Retries",
      description:
        "Number of times to re-prompt the model with validation errors when its output doesn't match the schema. 0 disables retries (fail on first mismatch).",
      minimum: 0,
      maximum: 10,
      default: 2,
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt", "outputSchema"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const StructuredGenerationOutputSchema = {
  type: "object",
  properties: {
    object: {
      type: "object",
      title: "Structured Output",
      description: "The generated structured object conforming to the provided schema",
      "x-stream": "object",
      "x-structured-output": true,
      additionalProperties: true,
    },
  },
  required: ["object"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StructuredGenerationTaskInput = FromSchema<typeof StructuredGenerationInputSchema>;
export type StructuredGenerationTaskOutput = FromSchema<typeof StructuredGenerationOutputSchema>;
export type StructuredGenerationTaskConfig = TaskConfig<StructuredGenerationTaskInput>;

/**
 * One round of validation errors from a failed attempt.
 */
export interface StructuredOutputValidationAttempt {
  readonly attempt: number;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
  /** The invalid object the model produced on this attempt. */
  readonly object: Record<string, unknown> | undefined;
}

/**
 * Thrown when the model's output fails schema validation on every attempt
 * (including retries).
 */
export class StructuredOutputValidationError extends TaskError {
  public static override readonly type: string = "StructuredOutputValidationError";
  public readonly attempts: ReadonlyArray<StructuredOutputValidationAttempt>;
  constructor(attempts: ReadonlyArray<StructuredOutputValidationAttempt>) {
    const last = attempts[attempts.length - 1];
    const summary = last?.errors.map((e) => `${e.path || "/"}: ${e.message}`).join("; ") ?? "";
    super(
      `StructuredGenerationTask: model output failed validation after ${attempts.length} attempt(s). ` +
        `Last errors: ${summary}`
    );
    this.attempts = attempts;
  }
}

function validationErrorsFromSchemaNode(
  result: ReturnType<SchemaNode["validate"]>
): ReadonlyArray<{ path: string; message: string }> {
  return result.errors.map((e) => ({ path: e.data.pointer || "", message: e.message }));
}

function buildRetryPrompt(
  originalPrompt: string,
  errors: ReadonlyArray<{ path: string; message: string }>
): string {
  const errorList = errors.map((e) => `  - ${e.path || "/"}: ${e.message}`).join("\n");
  return (
    `${originalPrompt}\n\n` +
    `Your previous response did not conform to the required JSON schema. ` +
    `Validation errors:\n${errorList}\n\n` +
    `Please respond again with a JSON object that satisfies the schema. ` +
    `Output ONLY the JSON object, no other text.`
  );
}

export class StructuredGenerationTask extends StreamingAiTask<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  StructuredGenerationTaskConfig
> {
  public static override type = "StructuredGenerationTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires = ["json-mode"] as const satisfies Capability[];
  protected static override readonly streamingPhaseLabel = "Generating";
  public static override category = "AI Text";
  public static override title = "Structured Generation";
  public static override description =
    "Generates structured JSON output conforming to a provided schema using language models, with automatic validation and retry on mismatch";
  public static override inputSchema(): DataPortSchema {
    return StructuredGenerationInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return StructuredGenerationOutputSchema as DataPortSchema;
  }

  /**
   * Runs the provider, validates the resulting object against `input.outputSchema`,
   * and retries with validation-error feedback up to `input.maxRetries` times if
   * the model's output doesn't match. Between attempts, emits an empty
   * object-delta so downstream accumulators reset.
   *
   * Throws:
   * - `TaskConfigurationError` if `input.outputSchema` isn't a compilable JSON Schema.
   * - `StructuredOutputValidationError` if every attempt fails validation.
   */
  override async *executeStream(
    input: StructuredGenerationTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
    // Compile the target schema once; fail fast if it's malformed so we don't
    // waste a provider round-trip.
    let validator: SchemaNode;
    try {
      validator = compileSchema(input.outputSchema);
      if (!input.outputSchema) throw new Error("outputSchema is not a valid JSON Schema");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const configErr = new TaskConfigurationError(
        `StructuredGenerationTask: invalid outputSchema — ${msg}`
      );
      configErr.taskType = this.type;
      configErr.taskId = this.id;
      throw configErr;
    }

    const maxRetries = Math.max(0, input.maxRetries ?? 2);
    const maxAttempts = maxRetries + 1;
    const attempts: StructuredOutputValidationAttempt[] = [];
    let currentInput = input;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let lastObject: Record<string, unknown> | undefined;

      for await (const event of super.executeStream(currentInput, context)) {
        if (event.type === "object-delta" && event.port === "object") {
          // Track the latest structured-output state for validation but also
          // pass the delta through so UIs can render progressive JSON.
          const delta = event.objectDelta;
          if (delta && !Array.isArray(delta)) {
            lastObject = delta as Record<string, unknown>;
          }
          yield event;
        } else if (event.type === "finish") {
          // Prefer the finish payload's object (some providers populate it);
          // fall back to the last object-delta.
          const data = event.data as StructuredGenerationTaskOutput | undefined;
          const finalObject = data?.object ?? lastObject ?? {};
          const result = validator.validate(finalObject);
          if (result.valid) {
            yield {
              type: "finish",
              data: { object: finalObject } as StructuredGenerationTaskOutput,
            } as StreamEvent<StructuredGenerationTaskOutput>;
            return;
          }
          // Record this attempt's errors for diagnostics.
          const errors = validationErrorsFromSchemaNode(result);
          attempts.push({ attempt, errors, object: finalObject });
          lastObject = finalObject;
          break; // stop consuming this attempt's stream — we already have finish
        } else {
          yield event;
        }
      }

      if (attempt < maxAttempts) {
        // Reset the downstream accumulator so the next attempt's partial
        // deltas don't merge with this one's garbage.
        yield {
          type: "object-delta",
          port: "object",
          objectDelta: {},
        } as StreamEvent<StructuredGenerationTaskOutput>;
        const lastErrors = attempts[attempts.length - 1]!.errors;
        currentInput = {
          ...input,
          prompt: buildRetryPrompt(input.prompt, lastErrors),
        };
      }
    }

    const err = new StructuredOutputValidationError(attempts);
    err.taskType = this.type;
    err.taskId = this.id;
    throw err;
  }

  /**
   * Drains executeStream so non-streaming callers get the validated output.
   * Without this override, `execute()` would route through the base class's
   * non-streaming path and bypass validation + retry entirely.
   */
  override async execute(
    input: StructuredGenerationTaskInput,
    context: IExecuteContext
  ): Promise<StructuredGenerationTaskOutput | undefined> {
    let result: StructuredGenerationTaskOutput | undefined;
    for await (const event of this.executeStream(input, context)) {
      if (event.type === "finish") {
        result = (event as { type: "finish"; data: StructuredGenerationTaskOutput }).data;
      }
    }
    return result;
  }
}

/**
 * Task for generating structured JSON output using a language model
 */
export const structuredGeneration = (
  input: StructuredGenerationTaskInput,
  config?: StructuredGenerationTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new StructuredGenerationTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    structuredGeneration: CreateWorkflow<
      StructuredGenerationTaskInput,
      StructuredGenerationTaskOutput,
      StructuredGenerationTaskConfig
    >;
  }
}

Workflow.prototype.structuredGeneration = CreateWorkflow(StructuredGenerationTask);
