//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model, ModelProcessorEnum, ModelUseCaseEnum } from "#/Model";
import { Task, TaskConfig } from "#/Task";
import { FilesetResolver, TextEmbedder } from "@mediapipe/tasks-text";

export class MediaPipeTfJsModel extends Model {
  constructor(
    name: string,
    useCase: ModelUseCaseEnum[],
    public url: string,
    options?: Partial<
      Pick<MediaPipeTfJsModel, "dimensions" | "parameters" | "browserOnly">
    >
  ) {
    super(name, useCase, options);
  }
  readonly type = ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL;
}

// ===============================================================================

interface DownloadTaskInput {
  model: MediaPipeTfJsModel;
}
export class MediaPipeTfJsLocal_DownloadTask extends Task {
  declare input: DownloadTaskInput;
  declare defaults: Partial<DownloadTaskInput>;
  readonly type = "DownloadTask";
  constructor(config: TaskConfig = {}, defaults: DownloadTaskInput) {
    config.name ||= `Downloading ${defaults.model.name}`;
    super(config, defaults);
  }

  public async run(overrides?: Partial<DownloadTaskInput>) {
    this.input = this.withDefaults(overrides);
    try {
      this.emit("start");
      const textFiles = await FilesetResolver.forTextTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm/"
      );
      await TextEmbedder.createFromOptions(textFiles, {
        baseOptions: {
          modelAssetPath: this.input.model.url,
        },
        quantize: true,
      });
      this.emit("complete");
    } catch (e) {
      this.emit("error", String(e));
    }
    return this.output;
  }
}

// ===============================================================================

interface EmbeddingTaskInput {
  text: string;
  model: MediaPipeTfJsModel;
}
/**
 * This is a task that generates an embedding for a single piece of text
 *
 * Model pipeline must be "feature-extraction"
 */
export class MediaPipeTfJsLocal_EmbeddingTask extends Task {
  declare input: EmbeddingTaskInput;
  declare defaults: Partial<EmbeddingTaskInput>;
  readonly type = "EmbeddingTask";
  constructor(config: TaskConfig = {}, defaults: EmbeddingTaskInput) {
    config.name ||= `Embedding content via ${defaults.model.name}`;
    config.output_name ||= "vector";
    super(config, defaults);
  }

  public async run(overrides?: Partial<EmbeddingTaskInput>) {
    this.input = this.withDefaults(overrides);

    this.emit("start");

    const textFiles = await FilesetResolver.forTextTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm/"
    );
    const textEmbedder = await TextEmbedder.createFromOptions(textFiles, {
      baseOptions: {
        modelAssetPath: this.input.model.url,
      },
      quantize: true,
    });

    const output = textEmbedder.embed(this.input.text);
    const vector = output.embeddings[0].floatEmbedding;

    if (vector?.length !== this.input.model.dimensions) {
      this.emit(
        "error",
        `Embedding vector length does not match model dimensions v${vector?.length} != m${this.input.model.dimensions}`
      );
    } else {
      this.output = { [this.config.output_name]: vector };
      this.emit("complete");
    }
    return this.output;
  }
}
