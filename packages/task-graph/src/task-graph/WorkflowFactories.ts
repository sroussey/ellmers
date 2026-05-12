/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, ITaskConstructor } from "../task/ITask";
import type { DataPorts, TaskConfig } from "../task/TaskTypes";
import { hasVectorLikeInput, hasVectorOutput } from "./GraphSchemaUtils";
import { Workflow } from "./Workflow";
import { getLastTask } from "./WorkflowPipe";

/**
 * Signature shared by all `Workflow.prototype.<x>` builder methods produced by
 * {@link CreateWorkflow}.
 *
 * The optional `runConfig` is forwarded to the task constructor, so callers can
 * attach a per-task {@link IRunConfig.resourceScope} (or other runtime knob)
 * before later invoking `workflow.run(...)`. The workflow's own
 * {@link WorkflowRunConfig.resourceScope}, if passed to `run()`, still wins
 * during execution — this third arg primarily exists so that the standalone
 * convenience wrappers (`chunkRetrieval`, `textEmbedding`, etc.) share a
 * uniform `(input, config, runConfig)` shape.
 */
export type CreateWorkflow<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I>> = (
  input?: Partial<I>,
  config?: Partial<C>,
  runConfig?: Partial<IRunConfig>
) => Workflow<I, O>;

export function CreateWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig<I> = TaskConfig<I>,
>(taskClass: ITaskConstructor<I, O, C>): CreateWorkflow<I, O, C> {
  return Workflow.createWorkflow<I, O, C>(taskClass);
}

/**
 * Type for loop workflow methods (map, while, reduce).
 * Represents the method signature with proper `this` context.
 * Loop methods take only a config parameter - input is not used for loop tasks.
 */
export type CreateLoopWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig<I> = TaskConfig<I>,
> = (this: Workflow<I, O>, config?: Partial<C>, runConfig?: Partial<IRunConfig>) => Workflow<I, O>;

/**
 * Factory function that creates a loop workflow method for a given task class.
 * Returns a method that can be assigned to Workflow.prototype.
 *
 * @param taskClass - The iterator task class (MapTask, ReduceTask, etc.)
 * @returns A method that creates the task and returns a loop builder workflow
 */
export function CreateLoopWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig<I> = TaskConfig<I>,
>(taskClass: ITaskConstructor<I, O, C>): CreateLoopWorkflow<I, O, C> {
  return function (
    this: Workflow<I, O>,
    config: Partial<C> = {},
    runConfig: Partial<IRunConfig> = {}
  ): Workflow<I, O> {
    return this.addLoopTask(taskClass, config, runConfig);
  };
}

/**
 * Type for end loop workflow methods (endMap, endBatch, etc.).
 */
export type EndLoopWorkflow = (this: Workflow) => Workflow;

/**
 * Factory function that creates an end loop workflow method.
 *
 * @param methodName - The name of the method (for error messages)
 * @returns A method that finalizes the loop and returns to the parent workflow
 */
export function CreateEndLoopWorkflow(methodName: string): EndLoopWorkflow {
  return function (this: Workflow): Workflow {
    if (!this.isLoopBuilder) {
      throw new Error(`${methodName}() can only be called on loop workflows`);
    }
    return this.finalizeAndReturn();
  };
}

/**
 * Type for adaptive workflow methods that dispatch to scalar or vector variant
 * based on the previous task's output schema.
 */
export type CreateAdaptiveWorkflow<
  IS extends DataPorts,
  _OS extends DataPorts,
  IV extends DataPorts,
  _OV extends DataPorts,
  CS extends TaskConfig<IS> = TaskConfig<IS>,
  CV extends TaskConfig<IV> = TaskConfig<IV>,
> = (
  this: Workflow,
  input?: Partial<IS> & Partial<IV>,
  config?: Partial<CS> & Partial<CV>,
  runConfig?: Partial<IRunConfig>
) => Workflow;

/**
 * Factory that creates an adaptive workflow method: when called, inspects the
 * output schema of the last task in the chain and delegates to the vector
 * variant if it has TypedArray output, otherwise to the scalar variant.
 * If there is no previous task, defaults to the scalar variant.
 *
 * @param scalarClass - Task class for scalar path (e.g. ScalarAddTask)
 * @param vectorClass - Task class for vector path (e.g. VectorSumTask)
 * @returns A method suitable for Workflow.prototype
 */
export function CreateAdaptiveWorkflow<
  IS extends DataPorts,
  OS extends DataPorts,
  IV extends DataPorts,
  OV extends DataPorts,
  CS extends TaskConfig<IS> = TaskConfig<IS>,
  CV extends TaskConfig<IV> = TaskConfig<IV>,
>(
  scalarClass: ITaskConstructor<IS, OS, CS>,
  vectorClass: ITaskConstructor<IV, OV, CV>
): CreateAdaptiveWorkflow<IS, OS, IV, OV, CS, CV> {
  const scalarHelper = Workflow.createWorkflow<IS, OS, CS>(scalarClass);
  const vectorHelper = Workflow.createWorkflow<IV, OV, CV>(vectorClass);

  return function (
    this: Workflow<any, any>,
    input: (Partial<IS> & Partial<IV>) | undefined = {},
    config: (Partial<CS> & Partial<CV>) | undefined = {},
    runConfig: Partial<IRunConfig> | undefined = {}
  ): Workflow {
    const parent = getLastTask(this);
    const useVector =
      (parent !== undefined && hasVectorOutput(parent)) || hasVectorLikeInput(input);
    if (useVector) {
      return vectorHelper.call(this, input, config, runConfig) as Workflow;
    }
    return scalarHelper.call(this, input, config, runConfig) as Workflow;
  };
}
