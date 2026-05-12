/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

const DownloadModelInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const DownloadModelOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DownloadModelTaskRunInput = FromSchema<typeof DownloadModelInputSchema>;
export type DownloadModelTaskRunOutput = FromSchema<typeof DownloadModelOutputSchema>;
export type DownloadModelTaskConfig = TaskConfig<DownloadModelTaskRunInput>;

/**
 * Download a model from a remote source and cache it locally.
 *
 * @remarks
 * This task has a side effect of downloading the model and caching it locally outside of the task system
 */
export class DownloadModelTask extends AiTask<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  DownloadModelTaskConfig
> {
  public static override type = "DownloadModelTask";
  public static override category = "AI Model";
  public static override title = "Download Model";
  public static override description =
    "Downloads and caches AI models locally with progress tracking";
  public static override inputSchema(): DataPortSchema {
    return DownloadModelInputSchema satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return DownloadModelOutputSchema satisfies DataPortSchema;
  }
  public static override cacheable = false;

  public files: { file: string; progress: number }[] = [];

  constructor(config: Partial<DownloadModelTaskConfig> = {}) {
    super(config);
    this.on("progress", this.processProgress.bind(this));
    this.on("start", () => {
      this.files = [];
    });
  }

  /**
   * Handles progress updates for the download task
   * @param progress - The progress value (0-100), or `undefined` for indeterminate
   * @param message - The message to display
   * @param details - Additional details about the progress
   */
  processProgress(
    progress: number | undefined,
    message: string = "",
    details?: {
      file?: string;
      progress?: number;
      /** Full snapshot (e.g. Hugging Face transformers pipeline); per-file % derived from loaded/total */
      files?: Record<string, { loaded: number; total: number }>;
      text?: number;
    }
  ): void {
    if (details?.files && typeof details.files === "object") {
      const entries = Object.entries(details.files);
      if (entries.length > 0) {
        this.files = entries
          .map(([file, info]) => ({
            file,
            progress: info.total > 0 ? (info.loaded / info.total) * 100 : 0,
          }))
          .sort((a, b) => a.file.localeCompare(b.file));
        this.progress = progress;
        return;
      }
    }
    if (details?.file !== undefined && details.progress !== undefined) {
      const file = this.files.find((f) => f.file === details.file);
      if (file) {
        file.progress = details.progress;
      } else {
        this.files.push({ file: details.file, progress: details.progress });
      }
      this.progress = this.files.reduce((acc, f) => acc + f.progress, 0) / this.files.length;
    } else {
      this.progress = progress;
    }
  }
}

/**
 * Download a model from a remote source and cache it locally.
 *
 * @param input - Input containing model(s) to download
 * @returns Promise resolving to the downloaded model(s)
 */
export const downloadModel = (
  input: DownloadModelTaskRunInput,
  config?: DownloadModelTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new DownloadModelTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    downloadModel: CreateWorkflow<
      DownloadModelTaskRunInput,
      DownloadModelTaskRunOutput,
      DownloadModelTaskConfig
    >;
  }
}

Workflow.prototype.downloadModel = CreateWorkflow(DownloadModelTask);
