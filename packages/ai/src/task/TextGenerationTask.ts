/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IRunConfig, StreamEvent, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";
import { TypeModel } from "./base/AiTaskSchemas";
import type { ResolvedCheckpoint } from "./base/CheckpointPorts";
import {
  CheckpointInputProperties,
  CheckpointOutputProperty,
  finalizeEmittedCheckpoint,
  promptToUserMessage,
  resolveCheckpointSession,
} from "./base/CheckpointPorts";
import { StreamingAiTask } from "./base/StreamingAiTask";

const generatedTextSchema = {
  type: "string",
  title: "Text",
  description: "The generated text",
  "x-stream": "append",
} as const;

const modelSchema = TypeModel("model:TextGenerationTask");

export const TextGenerationInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to generate text from",
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
    topP: {
      type: "number",
      title: "Top-p",
      description: "The top-p value to use for sampling",
      minimum: 0,
      maximum: 1,
      "x-ui-group": "Configuration",
    },
    frequencyPenalty: {
      type: "number",
      title: "Frequency Penalty",
      description: "The frequency penalty to use",
      minimum: -2,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
    presencePenalty: {
      type: "number",
      title: "Presence Penalty",
      description: "The presence penalty to use",
      minimum: -2,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
    ...CheckpointInputProperties,
  },
  required: ["model", "prompt"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextGenerationOutputSchema = {
  type: "object",
  properties: {
    text: generatedTextSchema,
    ...CheckpointOutputProperty,
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextGenerationTaskInput = {
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  topP?: number | undefined;
  frequencyPenalty?: number | undefined;
  presencePenalty?: number | undefined;
  model: string | ModelConfig;
  prompt: string;
  checkpoint?: string | undefined;
  emitCheckpoint?: boolean | undefined;
  keepParentCheckpoint?: boolean | undefined;
};
export type TextGenerationTaskOutput = { text: string; checkpoint?: string };
export type TextGenerationTaskConfig = TaskConfig<TextGenerationTaskInput>;

export class TextGenerationTask extends StreamingAiTask<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextGenerationTaskConfig
> {
  public static override type = "TextGenerationTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires = ["text.generation"] as const satisfies Capability[];
  protected static override readonly streamingPhaseLabel = "Generating";
  public static override category = "AI Text";
  public static override title = "Text Generation";
  public static override description =
    "Generates text from a prompt using language models with configurable parameters";
  public static override inputSchema(): DataPortSchema {
    return TextGenerationInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextGenerationOutputSchema as DataPortSchema;
  }

  private _resolvedCheckpoint: ResolvedCheckpoint | undefined;

  protected override async getJobInput(
    input: TextGenerationTaskInput
  ): Promise<AiJobInput<TextGenerationTaskInput>> {
    const jobInput = await super.getJobInput(input);
    const model = input.model as ModelConfig;
    if ((input.checkpoint || input.emitCheckpoint) && model && typeof model === "object") {
      this._resolvedCheckpoint ??= resolveCheckpointSession(input, model, "TextGenerationTask");
      if (this._resolvedCheckpoint) {
        jobInput.session = this._resolvedCheckpoint.session;
      }
    }
    return jobInput;
  }

  private async finalizeCheckpoint(input: TextGenerationTaskInput, text: string): Promise<void> {
    const resolved = this._resolvedCheckpoint;
    if (!resolved?.emitCheckpointId) return;
    await finalizeEmittedCheckpoint({
      model: input.model as ModelConfig,
      resolved,
      tailMessages: [promptToUserMessage(input.prompt)],
      assistantMessage: { role: "assistant", content: [{ type: "text", text }] },
      systemPrompt: undefined,
      tools: undefined,
    });
  }

  override async execute(
    input: TextGenerationTaskInput,
    executeContext: IExecuteContext
  ): Promise<TextGenerationTaskOutput | undefined> {
    await this.getJobInput(input);
    const output = await super.execute(input, executeContext);
    const emitId = this._resolvedCheckpoint?.emitCheckpointId;
    if (output && emitId) {
      await this.finalizeCheckpoint(input, output.text);
      return { ...output, checkpoint: emitId };
    }
    return output;
  }

  override async *executeStream(
    input: TextGenerationTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
    await this.getJobInput(input);
    const emitId = this._resolvedCheckpoint?.emitCheckpointId;
    if (!emitId) {
      yield* super.executeStream(input, context);
      return;
    }
    let text = "";
    for await (const event of super.executeStream(input, context)) {
      if (event.type === "text-delta" && (event.port ?? "text") === "text") {
        text += event.textDelta;
      }
      if (event.type === "finish") {
        await this.finalizeCheckpoint(input, text);
        yield {
          type: "text-delta",
          port: "checkpoint",
          textDelta: emitId,
        } as StreamEvent<TextGenerationTaskOutput>;
      }
      yield event;
    }
  }
}

export const textGeneration = (
  input: TextGenerationTaskInput,
  config?: TextGenerationTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextGenerationTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textGeneration: CreateWorkflow<
      TextGenerationTaskInput,
      TextGenerationTaskOutput,
      TextGenerationTaskConfig
    >;
  }
}

Workflow.prototype.textGeneration = CreateWorkflow(TextGenerationTask);
