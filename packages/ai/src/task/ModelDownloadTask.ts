/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

const ModelDownloadInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const ModelDownloadOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ModelDownloadTaskRunInput = { model: string | ModelConfig };
export type ModelDownloadTaskRunOutput = { model: string | ModelConfig };
export type ModelDownloadTaskConfig = TaskConfig<ModelDownloadTaskRunInput>;

/**
 * Download a model from a remote source and cache it locally.
 *
 * @remarks
 * This task has a side effect of downloading the model and caching it locally outside of the task system
 */
export class ModelDownloadTask extends AiTask<
  ModelDownloadTaskRunInput,
  ModelDownloadTaskRunOutput,
  ModelDownloadTaskConfig
> {
  public static override type = "ModelDownloadTask";
  /**
   * Resolves to the provider's `["model.download"]` run-fn registration.
   * Local providers (HFT, LlamaCpp) opt-in by registering a run-fn with
   * `serves: ["model.download"]`; cloud providers don't register one and
   * `ModelDownloadTask` for cloud models surfaces as a runtime "no run-fn
   * for provider serving model.download" error.
   */
  public static override readonly requires = ["model.download"] as const satisfies Capability[];

  /**
   * Provider-lifecycle override: `requires: ["model.download"]` routes the
   * dispatcher to the provider's download run-fn, but the *model* record
   * doesn't need to advertise `model.download` in its `capabilities` —
   * a model that's not yet downloaded by definition can't carry that flag
   * yet. Skip the capability gate; the dispatcher's `getRunFnFor` lookup
   * (against the provider, not the model record) is the real check.
   */
  protected override gateOrThrow(_model: ModelConfig): void {
    // intentional no-op
  }

  public static override category = "AI Model";
  public static override title = "Download Model";
  public static override description =
    "Downloads and caches AI models locally with progress tracking";
  public static override inputSchema(): DataPortSchema {
    return ModelDownloadInputSchema satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ModelDownloadOutputSchema satisfies DataPortSchema;
  }
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public files: { file: string; progress: number }[] = [];

  constructor(config: Partial<ModelDownloadTaskConfig> = {}) {
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
  input: ModelDownloadTaskRunInput,
  config?: ModelDownloadTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ModelDownloadTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    downloadModel: CreateWorkflow<
      ModelDownloadTaskRunInput,
      ModelDownloadTaskRunOutput,
      ModelDownloadTaskConfig
    >;
  }
}

Workflow.prototype.downloadModel = CreateWorkflow(ModelDownloadTask);
