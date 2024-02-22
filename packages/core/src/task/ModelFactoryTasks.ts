//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ConvertToArrays, arrayTaskFactory } from "./ArrayTask";
import { CreateMappedType } from "./TaskIOTypes";
import { TaskRegistry } from "./TaskRegistry";
import { ModelFactory } from "./ModelFactory";
import { TaskConfig } from "./Task";

// ===============================================================================

export type DownloadTaskInput = CreateMappedType<typeof DownloadTask.inputs>;
export type DownloadTaskOutput = CreateMappedType<typeof DownloadTask.outputs>;

export class DownloadTask extends ModelFactory {
  public static inputs = [
    {
      id: "model",
      name: "Model",
      valueType: "model",
    },
  ] as const;
  public static outputs = [
    {
      id: "model",
      name: "Model",
      valueType: "model",
    },
  ] as const;

  declare runInputData: DownloadTaskInput;
  declare runOutputData: DownloadTaskOutput;
  declare defaults: Partial<DownloadTaskInput>;
  constructor(config: TaskConfig & { input?: DownloadTaskInput }) {
    super(config);
  }
  static readonly type = "DownloadTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(DownloadTask);

export const DownloadMultiModelTask = arrayTaskFactory<
  ConvertToArrays<DownloadTaskInput, "model">,
  ConvertToArrays<DownloadTaskOutput, "model">
>(DownloadTask, "model", "text");

// ===============================================================================

export type EmbeddingTaskInput = CreateMappedType<typeof EmbeddingTask.inputs>;
export type EmbeddingTaskOutput = CreateMappedType<typeof EmbeddingTask.outputs>;

/**
 * This is a task that generates an embedding for a single piece of text
 */
export class EmbeddingTask extends ModelFactory {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_embedding_model",
    },
  ] as const;
  public static outputs = [{ id: "vector", name: "Embedding", valueType: "vector" }] as const;

  declare runInputData: EmbeddingTaskInput;
  declare runOutputData: EmbeddingTaskOutput;
  declare defaults: Partial<EmbeddingTaskInput>;
  static readonly type = "EmbeddingTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(EmbeddingTask);

export const EmbeddingMultiModelTask = arrayTaskFactory<
  ConvertToArrays<EmbeddingTaskInput, "model">,
  ConvertToArrays<EmbeddingTaskOutput, "vector">
>(EmbeddingTask, "model", "text");

// ===============================================================================

export type TextGenerationTaskInput = CreateMappedType<typeof TextGenerationTask.inputs>;
export type TextGenerationTaskOutput = CreateMappedType<typeof TextGenerationTask.outputs>;

/**
 * This generates text from a prompt
 */
export class TextGenerationTask extends ModelFactory {
  public static inputs = [
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

  declare runInputData: TextGenerationTaskInput;
  declare runOutputData: TextGenerationTaskOutput;
  declare defaults: Partial<TextGenerationTaskInput>;
  static readonly type = "TextGenerationTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextGenerationTask);

export const TextGenerationMultiModelTask = arrayTaskFactory<
  ConvertToArrays<TextGenerationTaskInput, "model">,
  ConvertToArrays<TextGenerationTaskOutput, "text">
>(TextGenerationTask, "model", "text");

// ===============================================================================

export type SummarizeTaskInput = CreateMappedType<typeof SummarizeTask.inputs>;
export type SummarizeTaskOutput = CreateMappedType<typeof SummarizeTask.outputs>;

/**
 * This summarizes a piece of text
 */

export class SummarizeTask extends ModelFactory {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_summarization_model",
    },
  ] as const;
  public static outputs = [{ id: "text", name: "Text", valueType: "text" }] as const;

  declare runInputData: SummarizeTaskInput;
  declare runOutputData: SummarizeTaskOutput;
  declare defaults: Partial<SummarizeTaskInput>;
  static readonly type = "SummarizeTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(SummarizeTask);

export const SummarizeMultiModelTask = arrayTaskFactory<
  ConvertToArrays<SummarizeTaskInput, "model">,
  ConvertToArrays<SummarizeTaskOutput, "text">
>(SummarizeTask, "model", "text");

// ===============================================================================

export type TextRewriterTaskInput = CreateMappedType<typeof TextRewriterTask.inputs>;
export type TextRewriterTaskOutput = CreateMappedType<typeof TextRewriterTask.outputs>;

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 */

export class TextRewriterTask extends ModelFactory {
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

  declare runInputData: TextRewriterTaskInput;
  declare runOutputData: TextRewriterTaskOutput;
  declare defaults: Partial<TextRewriterTaskInput>;
  static readonly type = "TextRewriterTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextRewriterTask);

export const TextRewriterMultiModelTask = arrayTaskFactory<
  ConvertToArrays<TextRewriterTaskInput, "model">,
  ConvertToArrays<TextRewriterTaskOutput, "text">
>(TextRewriterTask, "model", "text");

// ===============================================================================
export type QuestionAnswerTaskInput = CreateMappedType<typeof QuestionAnswerTask.inputs>;
export type QuestionAnswerTaskOutput = CreateMappedType<typeof QuestionAnswerTask.outputs>;

/**
 * This is a special case of text generation that takes a context and a question
 */
export class QuestionAnswerTask extends ModelFactory {
  public static inputs = [
    {
      id: "context",
      name: "Context",
      valueType: "text",
    },
    {
      id: "question",
      name: "Question",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_question_answering_model",
    },
  ] as const;
  public static outputs = [{ id: "answer", name: "Answer", valueType: "text" }] as const;

  declare runInputData: QuestionAnswerTaskInput;
  declare runOutputData: QuestionAnswerTaskOutput;
  declare defaults: Partial<QuestionAnswerTaskInput>;
  static readonly type = "QuestionAnswerTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(QuestionAnswerTask);

export const QuestionAnswerMultiModelTask = arrayTaskFactory<
  ConvertToArrays<QuestionAnswerTaskInput, "model">,
  ConvertToArrays<QuestionAnswerTaskOutput, "answer">
>(TextRewriterTask, "model", "answer");
