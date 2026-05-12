/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Base class for AI tasks that delegate execution to a
 * provider-registered strategy (direct or queued).
 */

import type {
  IExecuteContext,
  IExecutePreviewContext,
  TaskConfig,
  TaskEntitlement,
  TaskEntitlements,
  TaskOutput,
} from "@workglow/task-graph";
import {
  Entitlements,
  Task,
  TaskConfigSchema,
  TaskConfigurationError,
  TaskInput,
  hasStructuredOutput,
} from "@workglow/task-graph";
import type { ServiceRegistry } from "@workglow/util";
import type { DataPortSchema, JsonSchema } from "@workglow/util/schema";

import { noopEmit } from "../../capability/AiEmit";
import type { AiEmit } from "../../capability/AiEmit";
import { accumulatingEmit } from "../../capability/accumulatingEmit";
import type { Capability } from "../../capability/Capabilities";
import { AiJob, AiJobInput } from "../../job/AiJob";
import { MODEL_REPOSITORY } from "../../model/ModelRegistry";
import type { ModelRepository } from "../../model/ModelRepository";
import type { ModelConfig } from "../../model/ModelSchema";
import { getAiProviderRegistry } from "../../provider/AiProviderRegistry";

function schemaFormat(schema: JsonSchema): string | undefined {
  return typeof schema === "object" && schema !== null && "format" in schema
    ? schema.format
    : undefined;
}

/**
 * Returns true when a capability string is a legacy task class name (PascalCase ending in "Task",
 * e.g. "TextGenerationTask"). New-style capability strings use dot-notation or hyphen-notation
 * (e.g. "text.generation", "tool-use", "json-mode", "vision-input") and do NOT match this predicate.
 *
 * Legacy fixtures use task class names (e.g., 'TextGenerationTask'). New fixtures use capability
 * strings ('text.generation', 'tool-use', etc.). This guard preserves the legacy incompatibility
 * check only while old fixtures remain. Phase 4 removes both call sites.
 */
const isLegacyTaskClassName = (c: string): boolean => /^[A-Z][A-Za-z0-9]*Task$/.test(c);

const aiTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface AiTaskInput extends TaskInput {
  model: string | ModelConfig;
}

/**
 * A base class for AI related tasks that use an execution strategy
 * (direct or queued) determined by the provider at registration time.
 *
 * Model resolution is handled automatically by the TaskRunner before execution.
 * By the time execute() is called, input.model is always a ModelConfig object.
 */
export class AiTask<
  Input extends AiTaskInput = AiTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends Task<Input, Output, Config> {
  public static override type: string = "AiTask";
  public static override hasDynamicEntitlements: boolean = true;

  /**
   * Capabilities this task requires from the model selected at execution time.
   * The dispatcher (Phase 3) gates strictly: it throws unless
   * `model.capabilities ⊇ task.requires`. An empty array passes vacuously.
   *
   * Concrete subclasses MUST override with the relevant `Capability` values from
   * {@link CAPABILITIES}; pure-compute subclasses (no provider dispatch) keep `[]`.
   * Phase 4 populates the 44 concrete tasks; the test in `task/index.test.ts`
   * audits coverage.
   */
  public static readonly requires: readonly Capability[] = [];

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [{ id: Entitlements.AI_INFERENCE, reason: "Runs AI model inference" }],
    };
  }

  public override entitlements(): TaskEntitlements {
    const base: TaskEntitlement[] = [
      { id: Entitlements.AI_INFERENCE, reason: "Runs AI model inference" },
    ];
    // Prefer runInputData.model (runtime) over defaults.model (construction-time)
    const runModel = this.runInputData?.model;
    const modelId =
      typeof runModel === "string"
        ? runModel
        : typeof this.defaults.model === "string"
          ? this.defaults.model
          : undefined;
    if (modelId) {
      base.push({
        id: Entitlements.AI_MODEL,
        reason: `Uses model ${modelId}`,
        resources: [modelId],
      });
    }
    return { entitlements: base };
  }

  public static override configSchema(): DataPortSchema {
    return aiTaskConfigSchema;
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * Throws TaskConfigurationError if the model lacks any capability listed in
   * the task class's static `requires`. Both execute() and executeStream() must
   * call this before dispatch — gating is task-side, not strategy-side.
   */
  protected gateOrThrow(model: ModelConfig): void {
    const taskClass = this.constructor as typeof AiTask;
    const requires = taskClass.requires;
    const modelCaps = (model.capabilities as readonly Capability[] | undefined) ?? [];
    const missing = requires.filter((r) => !modelCaps.includes(r));
    if (missing.length > 0) {
      throw new TaskConfigurationError(
        `Model "${model.model_id ?? "(inline config)"}" is missing capabilities required by ` +
          `${taskClass.type}: ${missing.join(", ")}.`
      );
    }
  }

  override async execute(
    input: Input,
    executeContext: IExecuteContext
  ): Promise<Output | undefined> {
    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new TaskConfigurationError(
        "AiTask: Model was not resolved to ModelConfig - this indicates a bug in the resolution system"
      );
    }

    // Strict gating: the model must declare every capability this task requires.
    this.gateOrThrow(model);

    const jobInput = await this.getJobInput(input);
    const strategy = getAiProviderRegistry().getStrategy(model);

    const { emit, result } = accumulatingEmit<Output>();
    await strategy.execute(jobInput, executeContext, this.runConfig.runnerId, emit as AiEmit);
    const output = result();

    // Register a disposer so the caller can unload the model when done. The
    // unload path is wired via the "model.unload" capability so providers opt
    // in by registering a run-fn whose `serves` set contains it; bypasses the
    // task's own `requires` so we don't gate the lifecycle hook on the task.
    if (executeContext.resourceScope) {
      const registry = getAiProviderRegistry();
      const unloadFn = registry.getRunFnFor(model.provider, ["model.unload"]);
      if (unloadFn) {
        const modelPath =
          (model as ModelConfig & { model?: string }).model ??
          (model.provider_config as Record<string, unknown> | undefined)?.["model_path"] ??
          model.model_id;
        const resourceKey = `ai:${model.provider}:${modelPath}`;
        executeContext.resourceScope.register(resourceKey, async () => {
          // Phase 6: run-fns now return Promise<void> and emit via the
          // AiEmit callback. We don't care about events here, so use noopEmit.
          await unloadFn(
            { model } as TaskInput,
            model,
            AbortSignal.timeout(30_000),
            noopEmit
          );
        });
      }
    }

    return output;
  }

  // ========================================================================
  // Job creation
  // ========================================================================

  /**
   * Get the input to submit to the job queue (or direct execution).
   * Transforms the task input to AiJobInput format.
   */
  protected async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    const model = input.model as ModelConfig;

    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;
    const taskClass = this.constructor as typeof AiTask;

    const jobInput: AiJobInput<Input> = {
      taskType: runtype,
      requires: taskClass.requires,
      aiProvider: model.provider,
      taskInput: input as Input & { model: ModelConfig },
    };

    const taskTimeoutMs = (this.config as TaskConfig).timeout;
    if (typeof taskTimeoutMs === "number" && taskTimeoutMs > 0) {
      jobInput.timeoutMs = taskTimeoutMs;
    }

    // Attach structured output schema if the task declares it.
    const inputOutputSchema = input.outputSchema as DataPortSchema;
    if (
      inputOutputSchema &&
      typeof inputOutputSchema === "object" &&
      !Array.isArray(inputOutputSchema) &&
      typeof inputOutputSchema.type === "string"
    ) {
      jobInput.outputSchema = inputOutputSchema;
    } else {
      const taskOutputSchema = this.outputSchema();
      if (hasStructuredOutput(taskOutputSchema)) {
        jobInput.outputSchema = taskOutputSchema;
      }
    }

    const sessionId = (input as any).sessionId as string | undefined;
    if (sessionId) {
      jobInput.sessionId = sessionId;
    }

    return jobInput;
  }

  /**
   * Creates a new Job instance for direct execution (without a queue).
   */
  async createJob(input: Input, queueName?: string): Promise<AiJob<AiJobInput<Input>, Output>> {
    const jobInput = await this.getJobInput(input);
    const resolvedQueueName = queueName ?? (await this.getDefaultQueueName(input));
    if (!resolvedQueueName) {
      throw new TaskConfigurationError("AiTask: Unable to determine queue for AI provider");
    }
    const job = new AiJob<AiJobInput<Input>, Output>({
      queueName: resolvedQueueName,
      jobRunId: this.runConfig.runnerId,
      input: jobInput,
    });
    return job;
  }

  /**
   * Gets the default queue name based on the model's provider.
   */
  protected async getDefaultQueueName(input: Input): Promise<string | undefined> {
    const model = input.model as ModelConfig;
    return model?.provider;
  }

  // ========================================================================
  // Preview execution
  // ========================================================================

  /**
   * Delegates to a provider-registered preview run function if one exists,
   * otherwise falls back to the default Task.executePreview().
   */
  override async executePreview(
    input: Input,
    context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    const model = input.model as ModelConfig | undefined;
    if (model && typeof model === "object" && model.provider) {
      const taskType = (this.constructor as any).runtype ?? (this.constructor as any).type;
      const previewFn = getAiProviderRegistry().getPreviewRunFn<Input, Output>(
        model.provider,
        taskType
      );
      if (previewFn) {
        return previewFn(input, model);
      }
    }
    return super.executePreview(input, context);
  }

  // ========================================================================
  // Validation
  // ========================================================================

  /**
   * Validates that model inputs are valid ModelConfig objects.
   */
  public override async validateInput(input: Input): Promise<boolean> {
    const inputSchema = this.inputSchema();
    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        throw new TaskConfigurationError(`AiTask: Input schema is 'false' and accepts no inputs`);
      }
      return true;
    }

    const modelTaskProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema)?.startsWith("model:"));

    for (const [key] of modelTaskProperties) {
      const model = input[key];
      if (typeof model === "object" && model !== null) {
        const capabilities = (model as ModelConfig).capabilities;
        // Legacy fixtures use task class names (e.g., 'TextGenerationTask'). New fixtures use
        // capability strings ('text.generation', 'tool-use', 'json-mode', 'vision-input', etc.).
        // This guard preserves the legacy incompatibility check only while old fixtures remain.
        // Phase 4 removes both call sites.
        const usesTaskClassNames =
          Array.isArray(capabilities) && capabilities.some(isLegacyTaskClassName);
        if (usesTaskClassNames && !capabilities!.includes(this.type)) {
          const modelId = (model as ModelConfig).model_id ?? "(inline config)";
          throw new TaskConfigurationError(
            `AiTask: Model "${modelId}" for '${key}' is not compatible with task '${this.type}'. ` +
              `Model supports: [${capabilities!.join(", ")}]`
          );
        }
      } else if (model !== undefined && model !== null) {
        throw new TaskConfigurationError(
          `AiTask: Invalid model for '${key}' - expected ModelConfig object but got ${typeof model}. ` +
            `Ensure the model ID was registered in the ModelRepository before running the task.`
        );
      }
    }

    const modelPlainProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema) === "model");

    for (const [key] of modelPlainProperties) {
      const model = input[key];
      if (model !== undefined && model !== null && typeof model !== "object") {
        throw new TaskConfigurationError(
          `AiTask: Invalid model for '${key}' - expected ModelConfig object but got ${typeof model}. ` +
            `Ensure the model ID was registered in the ModelRepository before running the task.`
        );
      }
    }

    return super.validateInput(input);
  }

  public override async narrowInput(input: Input, registry: ServiceRegistry): Promise<Input> {
    const inputSchema = this.inputSchema();
    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        throw new TaskConfigurationError(`AiTask: Input schema is 'false' and accepts no inputs`);
      }
      return input;
    }
    const modelTaskProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema)?.startsWith("model:"));
    if (modelTaskProperties.length > 0) {
      const modelRepo = registry.get<ModelRepository>(MODEL_REPOSITORY);

      // Fetch models for this task type from the repository associated with the given registry.
      // Note: we intentionally avoid using a shared cache here to prevent mixing results
      // from different ServiceRegistry / ModelRepository instances.
      const taskModels: ModelConfig[] = (await modelRepo.findModelsByTask(this.type)) ?? [];

      for (const [key] of modelTaskProperties) {
        const requestedModel = input[key];

        if (typeof requestedModel === "string") {
          const found = taskModels?.find((m) => m.model_id === requestedModel);
          if (!found) {
            (input as any)[key] = undefined;
          }
        } else if (typeof requestedModel === "object" && requestedModel !== null) {
          const model = requestedModel as ModelConfig;
          const capabilities = model.capabilities;
          // Legacy fixtures use task class names (e.g., 'TextGenerationTask'). New fixtures use
          // capability strings ('text.generation', 'tool-use', 'json-mode', 'vision-input', etc.).
          // This guard preserves the legacy incompatibility check only while old fixtures remain.
          // Phase 4 removes both call sites.
          const usesTaskClassNames =
            Array.isArray(capabilities) && capabilities.some(isLegacyTaskClassName);
          if (usesTaskClassNames && !capabilities!.includes(this.type)) {
            (input as any)[key] = undefined;
          }
        }
      }
    }
    return input;
  }
}
