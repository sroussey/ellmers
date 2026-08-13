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

const ModelDownloadRemoveInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const ModelDownloadRemoveOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ModelDownloadRemoveTaskRunInput = { model: string | ModelConfig };
export type ModelDownloadRemoveTaskRunOutput = { model: string | ModelConfig };
export type ModelDownloadRemoveTaskConfig = TaskConfig<ModelDownloadRemoveTaskRunInput>;

/**
 * Unload a model from memory and clear its cache.
 *
 * @remarks
 * This task has a side effect of removing the model from memory and deleting cached files
 */
export class ModelDownloadRemoveTask extends AiTask<
  ModelDownloadRemoveTaskRunInput,
  ModelDownloadRemoveTaskRunOutput,
  ModelDownloadRemoveTaskConfig
> {
  public static override type = "ModelDownloadRemoveTask";
  /**
   * Resolves to the provider's `["model.download-remove"]` run-fn registration. Local
   * providers (HFT, Ollama, LlamaCpp, TFMP, chrome-ai) opt-in by registering
   * a run-fn with `serves: ["model.download-remove"]`; cloud providers don't register
   * one and `ModelDownloadRemoveTask` for cloud models is a no-op (or surfaces as a
   * runtime "no run-fn for provider serving model.unload" error).
   */
  public static override readonly requires = [
    "model.download-remove",
  ] as const satisfies Capability[];

  /**
   * Provider-lifecycle override: `requires: ["model.download-remove"]` routes the
   * dispatcher to the provider's unload run-fn, but the *model* record
   * doesn't need to advertise `model.unload` in its `capabilities` —
   * unload is a provider-side operation on whatever the provider has
   * resident, not a property of the model. Skip the capability gate.
   */
  protected override gateOrThrow(_model: ModelConfig): void {
    // intentional no-op
  }

  public static override category = "AI Model";
  public static override title = "Unload Model";
  public static override description =
    "Unloads and clears cached AI models from memory and storage";
  public static override inputSchema(): DataPortSchema {
    return ModelDownloadRemoveInputSchema satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ModelDownloadRemoveOutputSchema satisfies DataPortSchema;
  }
  public static override cachePolicy: CachePolicy = { kind: "none" };
}

/**
 * Unload a model from memory and clear its cache.
 *
 * @param input - Input containing model(s) to unload
 * @returns Promise resolving to the unloaded model(s)
 */
export const unloadModel = (
  input: ModelDownloadRemoveTaskRunInput,
  config?: ModelDownloadRemoveTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ModelDownloadRemoveTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    unloadModel: CreateWorkflow<
      ModelDownloadRemoveTaskRunInput,
      ModelDownloadRemoveTaskRunOutput,
      ModelDownloadRemoveTaskConfig
    >;
  }
}

Workflow.prototype.unloadModel = CreateWorkflow(ModelDownloadRemoveTask);
