//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ConvertAllToArrays,
  ConvertSomeToArray,
  ConvertSomeToOptionalArray,
  arrayTaskFactory,
  CreateMappedType,
  TaskRegistry,
  JobQueueTaskConfig,
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
} from "ellmers-core";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";

export type TextRewriterTaskInput = CreateMappedType<typeof TextRewriterTask.inputs>;
export type TextRewriterTaskOutput = CreateMappedType<typeof TextRewriterTask.outputs>;

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 */

export class TextRewriterTask extends JobQueueLlmTask {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "prompt",
      name: "Prompt",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_generation_model",
    },
  ] as const;
  public static outputs = [{ id: "text", name: "Text", valueType: "text" }] as const;
  constructor(config: JobQueueTaskConfig & { input?: TextRewriterTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextRewriterTaskInput;
  declare runOutputData: TextRewriterTaskOutput;
  declare defaults: Partial<TextRewriterTaskInput>;
  static readonly type = "TextRewriterTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextRewriterTask);

type TextRewriterCompoundTaskOutput = ConvertAllToArrays<TextRewriterTaskOutput>;

type TextRewriterCompoundTaskInput = ConvertSomeToOptionalArray<
  TextRewriterTaskInput,
  "model" | "text" | "prompt"
>;
export const TextRewriterCompoundTask = arrayTaskFactory<
  TextRewriterCompoundTaskInput,
  TextRewriterCompoundTaskOutput
>(TextRewriterTask, ["model", "text", "prompt"]);

export const TextRewriter = (input: TextRewriterCompoundTaskInput) => {
  if (Array.isArray(input.model) || Array.isArray(input.text) || Array.isArray(input.prompt)) {
    return new TextRewriterCompoundTask({ input }).run();
  } else {
    return new TextRewriterTask({ input } as { input: TextRewriterTaskInput }).run();
  }
};

declare module "ellmers-core" {
  interface TaskGraphBuilder {
    TextRewriter: TaskGraphBuilderHelper<TextRewriterCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextRewriter = TaskGraphBuilderHelper(TextRewriterCompoundTask);
