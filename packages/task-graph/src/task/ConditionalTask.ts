/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import type { UIConditionConfig } from "./ConditionUtils";
import { evaluateCondition, getNestedValue } from "./ConditionUtils";
import type { IExecuteContext } from "./ITask";
import { Task } from "./Task";
import type { TaskConfig, TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";
import { TaskConfigSchema } from "./TaskTypes";

/**
 * A predicate function that evaluates whether a branch condition is met.
 * Returns true if the branch should be active.
 */
export type ConditionFn<Input> = (input: Input) => boolean;

/**
 * Configuration for a single branch in a ConditionalTask. When `condition`
 * returns true, the branch becomes active and its output port receives the
 * task's input data.
 */
export interface BranchConfig<Input> {
  readonly id: string;
  readonly condition: ConditionFn<Input>;
  /** Name of the output port that will receive data when this branch is active */
  readonly outputPort: string;
}

export const conditionalTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    branches: { type: "array", items: {} },
    defaultBranch: { type: "string" },
    exclusive: { type: "boolean" },
    conditionConfig: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ConditionalTaskConfig = TaskConfig & {
  /** Branches may contain ConditionFn functions — not JSON-schema-representable */
  readonly branches?: BranchConfig<any>[];
  readonly defaultBranch?: string;
  readonly exclusive?: boolean;
  /** Serializable UI condition configuration used to build branches at runtime. */
  readonly conditionConfig?: UIConditionConfig;
};

/**
 * A task that evaluates conditions to determine which downstream paths are active.
 *
 * Implements conditional branching within a task graph (if/then/else or switch/case).
 * In exclusive mode (default), branches are evaluated in order and only the first
 * match activates. In multi-path mode, all matching branches activate simultaneously.
 * Inactive branches DISABLE their outgoing dataflows, cascading to downstream tasks
 * with no other active inputs.
 *
 * TWO OUTPUT SHAPES (selected by how branches are supplied):
 * - Function branches (config.branches with ConditionFn) -> {@link buildOutput}:
 *   `{ _activeBranches: string[], [outputPort]: { ...input } }`. This is the shape
 *   the instance `outputSchema()` describes.
 * - Serialized `conditionConfig` (from input or config, no function branches) ->
 *   {@link buildConditionConfigOutput}: UI-style `key_<n>` / `key_else` suffixed
 *   keys with NO `_activeBranches`. The declared outputSchema does NOT describe
 *   this shape, so consumers wiring dataflows off a conditionConfig-driven
 *   ConditionalTask must account for the suffixed keys explicitly.
 */
export class ConditionalTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends ConditionalTaskConfig = ConditionalTaskConfig,
> extends Task<Input, Output, Config> {
  /**
   * Marks the branch-routing family for the scheduler.
   *
   * The scheduler tests this instead of `instanceof` so it can reach this class
   * through a type-only import: a value import closes the
   * `Task -> TaskGraph -> TaskGraphRunner -> RunScheduler -> ConditionalTask`
   * module cycle, and any module that enters it at `Task` then evaluates this
   * class body before `Task` is defined. Subclasses inherit the flag, so the
   * check keeps `instanceof` semantics.
   */
  static readonly isConditionalTask = true;
  static override type: TaskTypeName = "ConditionalTask";
  static override category = "Flow Control";
  static override title = "Condition";
  static override description = "Route data based on conditions";
  static override hasDynamicSchemas: boolean = true;

  public static override configSchema(): DataPortSchema {
    return conditionalTaskConfigSchema;
  }

  public override canSerializeConfig(): boolean {
    if (!this.config.branches) return true;
    return !this.config.branches.some((b) => typeof b.condition === "function");
  }

  /**
   * Set of branch IDs that are currently active after execution.
   * Populated during execute() and used by the graph runner to
   * determine which dataflows should be enabled vs disabled.
   */
  public activeBranches: Set<string> = new Set();

  // ========================================================================
  // Execution methods
  // ========================================================================

  /**
   * Builds runtime branch configs from serialized UI condition config.
   */
  private buildBranchesFromConditionConfig(
    conditionConfig: UIConditionConfig
  ): BranchConfig<Input>[] {
    if (!conditionConfig?.branches || conditionConfig.branches.length === 0) {
      return [
        {
          id: "default",
          condition: () => true,
          outputPort: "1",
        },
      ];
    }

    return conditionConfig.branches.map((branch, index) => ({
      id: branch.id,
      outputPort: String(index + 1),
      condition: (inputData: Input): boolean => {
        const fieldValue = getNestedValue(inputData as Record<string, unknown>, branch.field);
        return evaluateCondition(fieldValue, branch.operator, branch.value);
      },
    }));
  }

  /**
   * Resolves the effective branches to evaluate.
   * Uses config.branches if they have condition functions,
   * otherwise falls back to conditionConfig from input or extras.
   */
  private resolveBranches(input: Input): {
    branches: BranchConfig<Input>[];
    isExclusive: boolean;
    defaultBranch: string | undefined;
    fromConditionConfig: boolean;
  } {
    const configBranches = this.config.branches ?? [];

    // If config branches have condition functions, use them directly
    if (configBranches.length > 0 && typeof configBranches[0].condition === "function") {
      return {
        branches: configBranches,
        isExclusive: this.config.exclusive ?? true,
        defaultBranch: this.config.defaultBranch,
        fromConditionConfig: false,
      };
    }

    // Try to find serialized conditionConfig from input or config
    const conditionConfig =
      ((input as Record<string, unknown>).conditionConfig as UIConditionConfig | undefined) ??
      this.config.conditionConfig;

    if (conditionConfig) {
      return {
        branches: this.buildBranchesFromConditionConfig(conditionConfig),
        isExclusive: conditionConfig.exclusive ?? true,
        defaultBranch: conditionConfig.defaultBranch,
        fromConditionConfig: true,
      };
    }

    // Fallback: use config branches even if they lack conditions
    return {
      branches: configBranches,
      isExclusive: this.config.exclusive ?? true,
      defaultBranch: this.config.defaultBranch,
      fromConditionConfig: false,
    };
  }

  public override async execute(
    input: Input,
    context: IExecuteContext
  ): Promise<Output | undefined> {
    if (context.signal?.aborted) {
      return undefined;
    }

    // Clear previous branch activation state
    this.activeBranches.clear();

    const { branches, isExclusive, defaultBranch, fromConditionConfig } =
      this.resolveBranches(input);

    // Evaluate each branch condition
    for (const branch of branches) {
      try {
        const isActive = branch.condition(input);
        if (isActive) {
          this.activeBranches.add(branch.id);
          if (isExclusive) {
            // In exclusive mode, stop at first match
            break;
          }
        }
      } catch (error) {
        // If condition throws, treat it as false (branch not taken)
        getLogger().error(`Condition evaluation failed for branch "${branch.id}":`, { error });
      }
    }

    // If no branch matched and there's a default, use it
    if (this.activeBranches.size === 0 && defaultBranch) {
      const defaultBranchExists = branches.some((b) => b.id === defaultBranch);
      if (defaultBranchExists) {
        this.activeBranches.add(defaultBranch);
      }
    }

    // Build output: if from conditionConfig, use the UI-style output building
    if (fromConditionConfig) {
      return this.buildConditionConfigOutput(input, branches, isExclusive);
    }

    // Build output: pass through input to active branch ports
    return this.buildOutput(input);
  }

  /**
   * Builds output in the UI-style format where inputs are passed through
   * with numbered suffixes based on matched branches.
   */
  protected buildConditionConfigOutput(
    input: Input,
    branches: BranchConfig<Input>[],
    isExclusive: boolean
  ): Output {
    const output: Record<string, unknown> = {};

    // Remove conditionConfig from pass-through data
    const { conditionConfig, ...passThrough } = input as Record<string, unknown>;
    const inputKeys = Object.keys(passThrough);

    // Find matched branch number
    let matchedBranchNumber: number | null = null;
    for (let i = 0; i < branches.length; i++) {
      if (this.activeBranches.has(branches[i].id)) {
        if (matchedBranchNumber === null) {
          matchedBranchNumber = i + 1;
        }
      }
    }

    if (isExclusive) {
      if (matchedBranchNumber !== null) {
        for (const key of inputKeys) {
          output[`${key}_${matchedBranchNumber}`] = passThrough[key];
        }
      } else {
        for (const key of inputKeys) {
          output[`${key}_else`] = passThrough[key];
        }
      }
    } else {
      for (let i = 0; i < branches.length; i++) {
        if (this.activeBranches.has(branches[i].id)) {
          for (const key of inputKeys) {
            output[`${key}_${i + 1}`] = passThrough[key];
          }
        }
      }
    }

    return output as Output;
  }

  /**
   * Builds the output object with data routed to active branch ports.
   * Each active branch's output port receives the full input data.
   *
   * @param input - The input data to pass through to active branches
   * @returns Output object with active branch ports populated
   */
  protected buildOutput(input: Input): Output {
    const output: Record<string, unknown> = {
      _activeBranches: Array.from(this.activeBranches),
    };

    const branches = this.config.branches ?? [];

    // For each active branch, populate its output port with the input data
    for (const branch of branches) {
      if (this.activeBranches.has(branch.id)) {
        // Pass through all input properties to the active branch's output port
        output[branch.outputPort] = { ...input };
      }
    }

    return output as Output;
  }

  // ========================================================================
  // Branch information methods
  // ========================================================================

  public isBranchActive(branchId: string): boolean {
    return this.activeBranches.has(branchId);
  }

  /** Returns a copy to prevent external modification. */
  public getActiveBranches(): Set<string> {
    return new Set(this.activeBranches);
  }

  public getPortActiveStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>();
    const branches = this.config.branches ?? [];

    for (const branch of branches) {
      status.set(branch.outputPort, this.activeBranches.has(branch.id));
    }

    return status;
  }

  // ========================================================================
  // Schema methods
  // ========================================================================

  static override outputSchema(): DataPortSchema {
    // Base schema - actual properties are determined by branch configuration
    return {
      type: "object",
      properties: {
        _activeBranches: {
          type: "array",
          items: { type: "string" },
          description: "List of active branch IDs after condition evaluation",
        },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  override outputSchema(): DataPortSchema {
    const branches = this.config?.branches ?? [];
    const properties: Record<string, any> = {
      _activeBranches: {
        type: "array",
        items: { type: "string" },
        description: "List of active branch IDs after condition evaluation",
      },
    };

    // Add each branch's output port to the schema
    for (const branch of branches) {
      properties[branch.outputPort] = {
        type: "object",
        description: `Output for branch "${branch.id}" when active`,
        additionalProperties: true,
      };
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as DataPortSchema;
  }

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
}
