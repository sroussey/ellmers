import type { JobQueueLlmTask, Model } from "ellmers-ai";
import type { CallbackStatus, PipelineProvider } from "./HFT_PipelineProvider";

// Initialize the worker
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
worker.onerror = (e) => {
  console.error("Worker error:", e.message, new URL("./worker.js", import.meta.url));
};

export class WorkerPipelineProvider implements PipelineProvider {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.worker.onerror = (e) => {
      console.error("Worker error:", e.message);
    };
  }

  async getPipeline(task: JobQueueLlmTask, model: Model, options: any = {}) {
    const pipeline = model.pipeline;
    const modelName = model.name;
    const id = task.config.id;

    return (...params: any[]) => {
      return new Promise((resolve, reject) => {
        // Listen for a message from the worker
        const listener = (e: MessageEvent<any>) => {
          console.log("main received worker message", e.data);
          if (e.data.id === id) {
            if (e.data.status === "complete") {
              // Unsubscribe listener after getting the final response
              worker.removeEventListener("message", listener);
              resolve(e.data.output);
            } else if (e.data.status === "progress") {
              this.downloadProgressCallback(task)(e.data);
            } else {
              this.generateProgressCallback(task)(e.data);
            }
          }
        };
        worker.addEventListener("message", listener);

        console.log("main sending worker ", {
          id,
          pipeline: pipeline,
          model: modelName,
          params: params,
          options: options,
        });
        // Send the task request to the worker
        worker.postMessage({
          id,
          pipeline: pipeline,
          model: modelName,
          params: params,
          options: options,
        });
      });
    };
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
