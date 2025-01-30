import type { JobQueueLlmTask, Model } from "ellmers-ai";
import { pipeline, type PipelineType } from "@huggingface/transformers";
import { QUANTIZATION_DATA_TYPES } from "../model/ONNXTransformerJsModel";
import type { CallbackStatus, PipelineProvider } from "./HFT_PipelineProvider";

export class InlinePipelineProvider implements PipelineProvider {
  private pipelines = new Map<Model, any>();

  async getPipeline(task: JobQueueLlmTask, model: Model, options: any = {}) {
    if (!this.pipelines.has(model)) {
      this.pipelines.set(
        model,
        await pipeline(model.pipeline as PipelineType, model.url, {
          dtype: (model.quantization as QUANTIZATION_DATA_TYPES) || "q8",
          session_options: options?.session_options,
          progress_callback: this.downloadProgressCallback(task),
        })
      );
    }
    return this.pipelines.get(model);
  }

  downloadProgressCallback(task: JobQueueLlmTask) {
    return (status: CallbackStatus) => {
      const progress = status.status === "progress" ? Math.round(status.progress) : 0;
      if (status.status === "progress") {
        task.progress = progress;
        task.emit("progress", progress, status.file);
      }
    };
  }

  generateProgressCallback(task: JobQueueLlmTask) {
    let count = 0;
    return (text: string) => {
      count++;
      const result = 100 * (1 - Math.exp(-0.05 * count));
      task.progress = Math.round(Math.min(result, 100));
      task.emit("progress", task.progress, text);
    };
  }
}
