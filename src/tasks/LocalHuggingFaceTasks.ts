//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { ONNXTransformerJsModel } from "#/Model";
import { Task } from "#/Task";
import { getPipeline } from "#/embeddings/TransformerJsService";

export class DownloadTask extends Task {
  constructor(private readonly model: ONNXTransformerJsModel) {
    super({ name: `Downloading ${model.name}` });
  }

  public async run(): Promise<void> {
    this.emit("start");
    await getPipeline(this.model, ({ progress }) => {
      this.progress = progress;
      this.emit("progress", progress);
    });
    this.emit("end");
  }
}
