// //    *******************************************************************************
// //    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
// //    *                                                                             *
// //    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
// //    *   Licensed under the Apache License, Version 2.0 (the "License");           *
// //    *******************************************************************************

import { CompoundTask, RegenerativeCompoundTask, TaskConfig, TaskInput } from "./base/Task";
import { DataFlow, TaskGraph } from "./base/TaskGraph";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { TaskRegistry } from "./base/TaskRegistry";

/**
 * Represents a single task item in the JSON configuration.
 * This structure defines how tasks should be configured in JSON format.
 */
export type JsonTaskItem = {
  id: unknown; // Unique identifier for the task
  type: string; // Type of task to create
  name?: string; // Optional display name for the task
  input?: TaskInput; // Input configuration for the task
  dependencies?: {
    // Defines data flow between tasks
    [x: string]: // Input parameter name
    | {
          id: unknown; // ID of the source task
          output: string; // Output parameter name from source task
        }
      | {
          id: unknown;
          output: string;
        }[];
  };
  provenance?: TaskInput; // Optional metadata about task origin
  subtasks?: JsonTaskItem[]; // Nested tasks for compound operations
};

type JsonTaskInput = {
  json: string;
};
type JsonTaskOutput = {
  output: any;
};

/**
 * JsonTask is a specialized task that creates and manages task graphs from JSON configurations.
 * It allows dynamic creation of task networks by parsing JSON definitions of tasks and their relationships.
 */
export class JsonTask extends RegenerativeCompoundTask {
  public static inputs = [
    {
      id: "json",
      name: "JSON",
      valueType: "text", // Expects JSON string input
    },
  ] as const;

  public static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "any", // Output type depends on the generated task graph
    },
  ] as const;

  declare runInputData: JsonTaskInput;
  declare runOutputData: JsonTaskOutput;
  declare defaults: Partial<JsonTaskInput>;

  constructor(config: TaskConfig & { input?: JsonTaskInput }) {
    super(config);
    if (config?.input?.json) {
      this.regenerateGraph();
    }
  }

  /**
   * Updates the task's input data and regenerates the graph if JSON input changes
   */
  public addInputData(overrides: Partial<JsonTaskInput> | undefined) {
    let changed = false;
    if (overrides?.json != this.runInputData.json) changed = true;
    super.addInputData(overrides);
    if (changed) this.regenerateGraph();
    return this;
  }

  /**
   * Creates a task instance from a JSON task item configuration
   * Validates required fields and resolves task type from registry
   */
  private createTask(item: JsonTaskItem) {
    if (!item.id) throw new Error("Task id required");
    if (!item.type) throw new Error("Task type required");
    if (item.input && (Array.isArray(item.input) || Array.isArray(item.provenance)))
      throw new Error("Task input must be an object");
    if (item.provenance && (Array.isArray(item.provenance) || typeof item.provenance !== "object"))
      throw new Error("Task provenance must be an object");

    const taskClass = TaskRegistry.all.get(item.type);
    if (!taskClass) throw new Error(`Task type ${item.type} not found`);

    const taskConfig = {
      id: item.id,
      name: item.name,
      input: item.input ?? {},
      provenance: item.provenance ?? {},
    };
    const task = new taskClass(taskConfig);
    if (item.subtasks) {
      (task as CompoundTask).subGraph = this.createSubGraph(item.subtasks);
    }
    return task;
  }

  /**
   * Creates a task graph from an array of JSON task items
   * Recursively processes subtasks for compound tasks
   */
  private createSubGraph(jsonItems: JsonTaskItem[]) {
    const subGraph = new TaskGraph();
    for (const subitem of jsonItems) {
      subGraph.addTask(this.createTask(subitem));
    }
    return subGraph;
  }

  /**
   * Regenerates the entire task graph based on the current JSON input
   * Creates task nodes and establishes data flow connections between them
   */
  public regenerateGraph() {
    if (!this.runInputData.json) return;
    let data = JSON.parse(this.runInputData.json) as JsonTaskItem[] | JsonTaskItem;
    if (!Array.isArray(data)) data = [data];
    const jsonItems: JsonTaskItem[] = data as JsonTaskItem[];

    // Create task nodes
    this.subGraph = this.createSubGraph(jsonItems);

    // Establish data flow connections
    for (const item of jsonItems) {
      if (!item.dependencies) continue;
      for (const [input, dependency] of Object.entries(item.dependencies)) {
        const dependencies = Array.isArray(dependency) ? dependency : [dependency];
        for (const dep of dependencies) {
          const sourceTask = this.subGraph.getTask(dep.id);
          if (!sourceTask) {
            throw new Error(`Dependency id ${dep.id} not found`);
          }
          const df = new DataFlow(sourceTask.config.id, dep.output, item.id, input);
          this.subGraph.addDataFlow(df);
        }
      }
    }
    super.regenerateGraph();
  }

  static readonly type = "JsonTask";
  static readonly category = "Utility";
}

// Register JsonTask with the task registry
TaskRegistry.registerTask(JsonTask);

/**
 * Helper function to create and configure a JsonTask instance
 */
const JsonBuilder = (input: JsonTaskInput) => {
  return new JsonTask({ input });
};

/**
 * Convenience function to create and run a JsonTask
 */
export const Json = (input: JsonTaskInput) => {
  return JsonBuilder(input).run();
};

// Add Json task builder to TaskGraphBuilder interface
declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    Json: TaskGraphBuilderHelper<JsonTaskInput>;
  }
}

TaskGraphBuilder.prototype.Json = TaskGraphBuilderHelper(JsonTask);
