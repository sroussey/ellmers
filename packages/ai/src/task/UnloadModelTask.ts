/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { TaskConfig } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

const UnloadModelInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const UnloadModelOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type UnloadModelTaskRunInput = FromSchema<typeof UnloadModelInputSchema>;
export type UnloadModelTaskRunOutput = FromSchema<typeof UnloadModelOutputSchema>;
export type UnloadModelTaskConfig = TaskConfig<UnloadModelTaskRunInput>;

/**
 * Unload a model from memory and clear its cache.
 *
 * @remarks
 * This task has a side effect of removing the model from memory and deleting cached files
 */
export class UnloadModelTask extends AiTask<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  UnloadModelTaskConfig
> {
  public static override type = "UnloadModelTask";
  /**
   * Resolves to the provider's `["model.unload"]` run-fn registration. Local
   * providers (HFT, Ollama, LlamaCpp, TFMP, chrome-ai) opt-in by registering
   * a run-fn with `serves: ["model.unload"]`; cloud providers don't register
   * one and `UnloadModelTask` for cloud models is a no-op (or surfaces as a
   * runtime "no run-fn for provider serving model.unload" error).
   */
  public static override readonly requires: readonly Capability[] = ["model.unload"] as const satisfies readonly Capability[];

  /**
   * Provider-lifecycle override: `requires: ["model.unload"]` routes the
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
    return UnloadModelInputSchema satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return UnloadModelOutputSchema satisfies DataPortSchema;
  }
  public static override cacheable = false;
}

/**
 * Unload a model from memory and clear its cache.
 *
 * @param input - Input containing model(s) to unload
 * @returns Promise resolving to the unloaded model(s)
 */
export const unloadModel = (input: UnloadModelTaskRunInput, config?: UnloadModelTaskConfig) => {
  return new UnloadModelTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    unloadModel: CreateWorkflow<
      UnloadModelTaskRunInput,
      UnloadModelTaskRunOutput,
      UnloadModelTaskConfig
    >;
  }
}

Workflow.prototype.unloadModel = CreateWorkflow(UnloadModelTask);
