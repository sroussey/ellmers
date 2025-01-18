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

/**
 * Events that can be emitted by the TaskGraphRepository
 */
export type TaskGraphEvents = "graph_saved" | "graph_retrieved" | "graph_cleared";

/**
 * Abstract repository class for managing task graphs persistence and retrieval.
 * Provides functionality to save, load, and manipulate task graphs with their associated tasks and data flows.
 */
export abstract class TaskGraphRepository {
  public type = "TaskGraphRepository";
  abstract kvRepository: KVRepository;
  private events = new EventEmitter<TaskGraphEvents>();

  /**
   * Registers an event listener for the specified event
   * @param name The event name to listen for
   * @param fn The callback function to execute when the event occurs
   */
  on(name: TaskGraphEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }

  /**
   * Removes an event listener for the specified event
   * @param name The event name to stop listening for
   * @param fn The callback function to remove
   */
  off(name: TaskGraphEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }

  /**
   * Emits an event with the given arguments
   * @param name The event name to emit
   * @param args Additional arguments to pass to the event listeners
   */
  emit(name: TaskGraphEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
  }

  /**
   * Creates a task instance from a task graph item JSON representation
   * @param item The JSON representation of the task
   * @returns A new task instance
   * @throws Error if required fields are missing or invalid
   */
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

  /**
   * Creates a TaskGraph instance from its JSON representation
   * @param graphJsonObj The JSON representation of the task graph
   * @returns A new TaskGraph instance with all tasks and data flows
   */
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

  /**
   * Saves a task graph to persistent storage
   * @param key The unique identifier for the task graph
   * @param output The task graph to save
   * @emits graph_saved when the operation completes
   */
  async saveTaskGraph(key: string, output: TaskGraph): Promise<void> {
    const value = JSON.stringify(output.toJSON());
    await this.kvRepository.put(key, value);
    this.emit("graph_saved", key);
  }

  /**
   * Retrieves a task graph from persistent storage
   * @param key The unique identifier of the task graph to retrieve
   * @returns The retrieved task graph, or undefined if not found
   * @emits graph_retrieved when the operation completes successfully
   */
  async getTaskGraph(key: string): Promise<TaskGraph | undefined> {
    const jsonStr = (await this.kvRepository.get(key)) as string;
    if (!jsonStr) {
      return undefined;
    }
    const jsonObj = JSON.parse(jsonStr);

    const graph = this.createSubGraph(jsonObj);

    this.emit("graph_retrieved", key);
    return graph;
  }

  /**
   * Clears all task graphs from the repository
   * @emits graph_cleared when the operation completes
   */
  async clear(): Promise<void> {
    await this.kvRepository.deleteAll();
    this.emit("graph_cleared");
  }

  /**
   * Returns the number of task graphs stored in the repository
   * @returns The count of stored task graphs
   */
  async size(): Promise<number> {
    return await this.kvRepository.size();
  }
}
