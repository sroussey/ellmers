/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import { createServiceToken, EventEmitter } from "@workglow/util";
import type { TaskGraph } from "../task-graph/TaskGraph";

/**
 * Service token for TaskGraphRepository
 */
export const TASK_GRAPH_REPOSITORY = createServiceToken<TaskGraphRepository>(
  "taskgraph.taskGraphRepository"
);

/**
 * Events that can be emitted by the TaskGraphRepository
 */
export type TaskGraphRepositoryEvents = keyof TaskGraphRepositoryEventListeners;

export type TaskGraphRepositoryEventListeners = {
  graph_saved: (key: string) => void;
  graph_retrieved: (key: string) => void;
  graph_cleared: () => void;
};

export type TaskGraphRepositoryEventListener<Event extends TaskGraphRepositoryEvents> =
  TaskGraphRepositoryEventListeners[Event];

export type TaskGraphRepositoryEventParameters<Event extends TaskGraphRepositoryEvents> =
  EventParameters<TaskGraphRepositoryEventListeners, Event>;

/**
 * Repository class for managing task graphs persistence and retrieval.
 * Provides functionality to save, load, and manipulate task graphs with their associated tasks and data flows.
 */
export abstract class TaskGraphRepository {
  /**
   * The type of the repository
   */
  public type = "TaskGraphRepository";

  /**
   * The event emitter for the task graphs
   */
  private get events() {
    if (!this._events) {
      this._events = new EventEmitter<TaskGraphRepositoryEventListeners>();
    }
    return this._events;
  }
  private _events: EventEmitter<TaskGraphRepositoryEventListeners> | undefined;

  /**
   * Registers an event listener for the specified event
   * @param name The event name to listen for
   * @param fn The callback function to execute when the event occurs
   */
  on<Event extends TaskGraphRepositoryEvents>(
    name: Event,
    fn: TaskGraphRepositoryEventListener<Event>
  ) {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener for the specified event
   * @param name The event name to stop listening for
   * @param fn The callback function to remove
   */
  off<Event extends TaskGraphRepositoryEvents>(
    name: Event,
    fn: TaskGraphRepositoryEventListener<Event>
  ) {
    this.events.off(name, fn);
  }

  /**
   * Adds an event listener that will only be called once
   * @param name The event name to listen for
   * @param fn The callback function to execute when the event occurs
   */
  once<Event extends TaskGraphRepositoryEvents>(
    name: Event,
    fn: TaskGraphRepositoryEventListener<Event>
  ) {
    this.events.once(name, fn);
  }

  /**
   * Returns when the event was emitted (promise form of once)
   * @param name The event name to check
   * @returns true if the event has listeners, false otherwise
   */
  waitOn<Event extends TaskGraphRepositoryEvents>(name: Event) {
    return this.events.waitOn(name) as Promise<TaskGraphRepositoryEventParameters<Event>>;
  }

  /**
   * Emits an event (if there are listeners)
   * @param name The event name to emit
   * @param args The event parameters
   */
  emit<Event extends TaskGraphRepositoryEvents>(
    name: Event,
    ...args: TaskGraphRepositoryEventParameters<Event>
  ) {
    this._events?.emit(name, ...args);
  }

  /**
   * Saves a task graph to persistent storage
   * @param key The unique identifier for the task graph
   * @param output The task graph to save
   * @emits graph_saved when the operation completes
   */
  abstract saveTaskGraph(key: string, output: TaskGraph): Promise<void>;

  /**
   * Retrieves a task graph from persistent storage
   * @param key The unique identifier of the task graph to retrieve
   * @returns The retrieved task graph, or undefined if not found
   * @emits graph_retrieved when the operation completes successfully
   */
  abstract getTaskGraph(key: string): Promise<TaskGraph | undefined>;

  /**
   * Clears all task graphs from the repository
   * @emits graph_cleared when the operation completes
   */
  abstract clear(): Promise<void>;

  /**
   * Returns the number of task graphs stored in the repository
   * @returns The count of stored task graphs
   */
  abstract size(): Promise<number>;
}
