//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { DataFlow, TaskGraph, TaskGraphItemJson, TaskGraphJson } from "../../task/base/TaskGraph";
import { KVRepository } from "../base/KVRepository";
import { CompoundTask } from "../../task/base/Task";
import { TaskRegistry } from "../../task/base/TaskRegistry";

export type TaskGraphEvents = "graph_saved" | "graph_retrieved" | "graph_cleared";

export abstract class TaskGraphRepository {
  public type = "TaskGraphRepository";
  abstract kvRepository: KVRepository<unknown, TaskGraphJson>;
  private events = new EventEmitter<TaskGraphEvents>();
  on(name: TaskGraphEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }
  off(name: TaskGraphEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }
  emit(name: TaskGraphEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
  }

  private createTask(item: TaskGraphItemJson) {
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
    if (item.subgraph) {
      (task as CompoundTask).subGraph = this.createSubGraph(item.subgraph);
    }
    return task;
  }

  public createSubGraph(graphJsonObj: TaskGraphJson) {
    const subGraph = new TaskGraph();
    for (const subitem of graphJsonObj.nodes) {
      subGraph.addTask(this.createTask(subitem));
    }
    for (const subitem of graphJsonObj.edges) {
      subGraph.addDataFlow(
        new DataFlow(
          subitem.sourceTaskId,
          subitem.sourceTaskOutputId,
          subitem.targetTaskId,
          subitem.targetTaskInputId
        )
      );
    }
    return subGraph;
  }

  async saveTaskGraph(id: unknown, output: TaskGraph): Promise<void> {
    const jsonObj = output.toJSON();
    await this.kvRepository.put(id, jsonObj);
    this.emit("graph_saved", id);
  }

  async getTaskGraph(id: unknown): Promise<TaskGraph | undefined> {
    const jsonObj = await this.kvRepository.get(id);
    if (!jsonObj) {
      return undefined;
    }

    const graph = this.createSubGraph(jsonObj);

    this.emit("graph_retrieved", id);
    return graph;
  }

  async clear(): Promise<void> {
    await this.kvRepository.clear();
    this.emit("graph_cleared");
  }

  async size(): Promise<number> {
    return await this.kvRepository.size();
  }
}
