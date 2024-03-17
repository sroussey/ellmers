// //    *******************************************************************************
// //    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
// //    *                                                                             *
// //    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
// //    *   Licensed under the Apache License, Version 2.0 (the "License");           *
// //    *******************************************************************************

import { CompoundTask, TaskConfig, TaskInput } from "./base/Task";
import { DataFlow, TaskGraph } from "./base/TaskGraph";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";

export type JsonTaskArray = Array<JsonTaskItem>;
export type JsonTaskItem = {
  id: string;
  type: string;
  name?: string;
  input?: TaskInput;
  dependencies?: {
    [x: string]: {
      id: string;
      output: string;
    };
  };
  provenance?: TaskInput;
};

type JsonTaskInput = CreateMappedType<typeof JsonTask.inputs>;
type JsonTaskOutput = CreateMappedType<typeof JsonTask.outputs>;

export class JsonTask extends CompoundTask {
  public static inputs = [
    {
      id: "json",
      name: "JSON",
      valueType: "text",
    },
  ] as const;

  declare runInputData: JsonTaskInput;
  declare runOutputData: JsonTaskOutput;
  declare defaults: Partial<JsonTaskInput>;

  constructor(config: TaskConfig & { input?: JsonTaskInput }) {
    super(config);
    if (config?.input?.json) {
      this.generateGraph();
    }
  }

  public addInputData(overrides: Partial<JsonTaskInput> | undefined) {
    let changed = false;
    if (overrides?.json != this.runInputData.json) changed = true;
    super.addInputData(overrides);
    if (changed) this.generateGraph();
    return this;
  }

  public generateGraph() {
    if (!this.runInputData.json) return;
    let data = JSON.parse(this.runInputData.json);
    if (!Array.isArray(data)) data = [data];
    const jsonItems: JsonTaskArray = data as JsonTaskArray;
    // create the task nodes
    this.subGraph = new TaskGraph();
    for (const item of jsonItems) {
      if (!item.id) throw new Error("Task id required");
      if (!item.type) throw new Error("Task type required");
      if (item.input && (Array.isArray(item.input) || Array.isArray(item.provenance)))
        throw new Error("Task input must be an object");
      if (
        item.provenance &&
        (Array.isArray(item.provenance) || typeof item.provenance !== "object")
      )
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
      this.subGraph.addTask(task);
    }
    // create the data flow edges
    for (const item of jsonItems) {
      if (!item.dependencies) continue;
      for (const [input, dependency] of Object.entries(item.dependencies)) {
        const sourceTask = this.subGraph.getTask(dependency.id);
        if (!sourceTask) {
          throw new Error(`Dependency id ${dependency.id} not found`);
        }
        const df = new DataFlow(sourceTask.config.id, dependency.output, item.id, input);
        this.subGraph.addDataFlow(df);
      }
    }
  }

  static readonly type = "JsonTask";
  static readonly category = "Utility";
}

TaskRegistry.registerTask(JsonTask);

const JsonBuilder = (input: JsonTaskInput) => {
  return new JsonTask({ input });
};

export const Json = (input: JsonTaskInput) => {
  return JsonBuilder(input).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    Json: TaskGraphBuilderHelper<JsonTaskInput>;
  }
}

TaskGraphBuilder.prototype.Json = TaskGraphBuilderHelper(JsonTask);
