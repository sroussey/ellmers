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

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * A predicate function that evaluates whether a branch condition is met.
 * Receives the task's input data and returns true if the branch should be active.
 *
 * @template Input - The input type for the conditional task
 * @param input - The input data to evaluate
 * @returns true if the branch condition is met, false otherwise
 *
 * @example
 * ```typescript
 * // Simple numeric comparison
 * const isHighValue: ConditionFn<{ value: number }> = (input) => input.value > 100;
 *
 * // String equality check
 * const isAdmin: ConditionFn<{ role: string }> = (input) => input.role === "admin";
 *
 * // Complex boolean logic
 * const isEligible: ConditionFn<{ age: number; verified: boolean }> = (input) =>
 *   input.age >= 18 && input.verified;
 * ```
 */
export type ConditionFn<Input> = (input: Input) => boolean;

/**
 * Configuration for a single branch in a ConditionalTask.
 *
 * Each branch represents a possible path through the conditional logic.
 * When the condition evaluates to true, the branch becomes active and
 * its output port will receive the task's input data.
 *
 * @template Input - The input type for the conditional task
 *
 * @example
 * ```typescript
 * const highValueBranch: BranchConfig<{ amount: number }> = {
 *   id: "high",
 *   condition: (input) => input.amount > 1000,
 *   outputPort: "highValue"
 * };
 * ```
 */
export interface BranchConfig<Input> {
  /** Unique identifier for this branch within the task */
  readonly id: string;

  /** Predicate function that determines if this branch is active */
  readonly condition: ConditionFn<Input>;

  /** Name of the output port that will receive data when this branch is active */
  readonly outputPort: string;
}

/**
 * Configuration interface for ConditionalTask.
 *
 * Extends the base TaskConfig with conditional-specific options including
 * branch definitions, default branch handling, and execution mode.
 *
 * @example
 * ```typescript
 * const config: ConditionalTaskConfig = {
 *   id: "router",
 *   branches: [
 *     { id: "premium", condition: (i) => i.tier === "premium", outputPort: "premium" },
 *     { id: "standard", condition: (i) => i.tier === "standard", outputPort: "standard" },
 *   ],
 *   defaultBranch: "standard",
 *   exclusive: true, // Only first matching branch activates
 * };
 * ```
 */
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

// ============================================================================
// ConditionalTask Class
// ============================================================================

/**
 * A task that evaluates conditions to determine which downstream paths are active.
 *
 * ConditionalTask implements conditional branching within a task graph, similar to
 * if/then/else or switch/case statements. It evaluates configured conditions against
 * its input and selectively enables output ports for active branches while disabling
 * dataflows to inactive branches.
 *
 * ## Key Features
 *
 * - **Condition-based routing**: Route data to different downstream tasks based on input values
 * - **Exclusive mode**: Act as a switch/case where only the first matching branch activates
 * - **Multi-path mode**: Enable multiple branches simultaneously when conditions match
 * - **Default branch**: Specify a fallback branch when no conditions match
 * - **Disabled propagation**: Inactive branches result in DISABLED status for downstream tasks
 *
 * ## Execution Modes
 *
 * ### Exclusive Mode (default)
 * In exclusive mode (`exclusive: true`), the task behaves like a switch statement.
 * Branches are evaluated in order, and only the first matching branch becomes active.
 * This is useful for mutually exclusive paths.
 *
 * ### Multi-Path Mode
 * In multi-path mode (`exclusive: false`), all branches whose conditions evaluate
 * to true become active simultaneously. This enables fan-out patterns where the
 * same input triggers multiple downstream processing paths.
 *
 * ## Output Behavior
 *
 * For each active branch, the task passes through its entire input to that branch's
 * output port. Inactive branches receive no data, and their outgoing dataflows are
 * set to DISABLED status, which cascades to downstream tasks that have no other
 * active inputs.
 *
 * @template Input - The input type for the task
 * @template Output - The output type for the task
 * @template Config - The configuration type (must extend ConditionalTaskConfig)
 *
 * @example
 * ```typescript
 * // Simple if/else routing based on a numeric threshold
 * const thresholdRouter = new ConditionalTask(
 *   {},
 *   {
 *     branches: [
 *       { id: "high", condition: (i) => i.value > 100, outputPort: "highPath" },
 *       { id: "low", condition: (i) => i.value <= 100, outputPort: "lowPath" },
 *     ],
 *   }
 * );
 *
 * // Switch/case style routing based on string enum
 * const statusRouter = new ConditionalTask(
 *   {},
 *   {
 *     branches: [
 *       { id: "active", condition: (i) => i.status === "active", outputPort: "active" },
 *       { id: "pending", condition: (i) => i.status === "pending", outputPort: "pending" },
 *       { id: "inactive", condition: (i) => i.status === "inactive", outputPort: "inactive" },
 *     ],
 *     defaultBranch: "inactive",
 *     exclusive: true,
 *   }
 * );
 *
 * // Multi-path fan-out for parallel processing
 * const fanOut = new ConditionalTask(
 *   {},
 *   {
 *     branches: [
 *       { id: "log", condition: () => true, outputPort: "logger" },
 *       { id: "process", condition: () => true, outputPort: "processor" },
 *       { id: "archive", condition: (i) => i.shouldArchive, outputPort: "archiver" },
 *     ],
 *     exclusive: false, // All matching branches activate
 *   }
 * );
 * ```
 */
export class ConditionalTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends ConditionalTaskConfig = ConditionalTaskConfig,
> extends Task<Input, Output, Config> {
  /** Task type identifier for serialization and registry lookup */
  static override type: TaskTypeName = "ConditionalTask";

  /** Category for UI organization and filtering */
  static override category = "Flow Control";

  /** Human-readable title for display in UIs */
  static override title = "Condition";
  static override description = "Route data based on conditions";

  /** This task has dynamic schemas that change based on branch configuration */
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
   * Evaluates branch conditions and determines which branches are active.
   * Only active branches will have their output ports populated.
   *
   * @param input - The input data to evaluate conditions against
   * @param context - Execution context with signal and progress callback
   * @returns Output with active branch data and metadata
   */
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

  /**
   * Checks if a specific branch is currently active.
   *
   * @param branchId - The ID of the branch to check
   * @returns true if the branch is active, false otherwise
   *
   * @example
   * ```typescript
   * await conditionalTask.run({ value: 150 });
   * if (conditionalTask.isBranchActive("high")) {
   *   console.log("High value path was taken");
   * }
   * ```
   */
  public isBranchActive(branchId: string): boolean {
    return this.activeBranches.has(branchId);
  }

  /**
   * Gets the set of currently active branch IDs.
   * Returns a new Set to prevent external modification.
   *
   * @returns Set of active branch IDs
   */
  public getActiveBranches(): Set<string> {
    return new Set(this.activeBranches);
  }

  /**
   * Gets a map of output port names to their active status.
   * Useful for inspecting which output ports will have data.
   *
   * @returns Map of output port name to boolean active status
   *
   * @example
   * ```typescript
   * const portStatus = conditionalTask.getPortActiveStatus();
   * for (const [port, isActive] of portStatus) {
   *   console.log(`Port ${port}: ${isActive ? "active" : "inactive"}`);
   * }
   * ```
   */
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

  /**
   * Generates the output schema dynamically based on configured branches.
   * Each branch's output port is defined as an object type that will
   * receive the pass-through input data when active.
   *
   * @returns JSON Schema for the task's output
   */
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

  /**
   * Instance method to get output schema with branch-specific ports.
   * Dynamically generates properties based on the configured branches.
   *
   * @returns JSON Schema for the task's output including branch ports
   */
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

  /**
   * Returns schema indicating the task accepts any input.
   * ConditionalTask passes through its input to active branches,
   * so it doesn't constrain the input type.
   *
   * @returns Schema that accepts any input
   */
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Instance method returning schema that accepts any input.
   *
   * @returns Schema that accepts any input
   */
  override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
}
