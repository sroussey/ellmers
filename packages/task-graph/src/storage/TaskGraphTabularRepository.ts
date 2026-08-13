/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseTabularStorage } from "@workglow/storage";
import type { ServiceRegistry } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import type { TaskGraph } from "../task-graph/TaskGraph";
import { createGraphFromGraphJSON } from "../task/TaskJSON";
import { TaskGraphRepository } from "./TaskGraphRepository";

export const TaskGraphSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    value: { type: "string" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const TaskGraphPrimaryKeyNames = ["key"] as const;

/**
 * Options for the TaskGraphRepository
 */
export type TaskGraphRepositoryStorage = BaseTabularStorage<
  typeof TaskGraphSchema,
  typeof TaskGraphPrimaryKeyNames
>;
type TaskGraphRepositoryOptions = {
  tabularRepository: TaskGraphRepositoryStorage;
  registry?: ServiceRegistry;
};

/**
 * Repository class for managing task graphs persistence and retrieval.
 * Provides functionality to save, load, and manipulate task graphs with their associated tasks and data flows.
 */
export class TaskGraphTabularRepository extends TaskGraphRepository {
  /**
   * The type of the repository
   */
  public override type = "TaskGraphTabularRepository";

  /**
   * The tabular repository for the task graphs
   */
  tabularRepository: TaskGraphRepositoryStorage;

  /**
   * Optional service registry for DI-based task constructor lookups
   */
  readonly registry: ServiceRegistry | undefined;

  /**
   * Constructor for the TaskGraphRepository
   * @param options The options for the repository
   */
  constructor({ tabularRepository, registry }: TaskGraphRepositoryOptions) {
    super();
    this.tabularRepository = tabularRepository;
    this.registry = registry;
  }

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  async setupDatabase(): Promise<void> {
    await this.tabularRepository.setupDatabase?.();
  }

  /**
   * Saves a task graph to persistent storage
   * @param key The unique identifier for the task graph
   * @param output The task graph to save
   * @emits graph_saved when the operation completes
   */
  async saveTaskGraph(key: string, output: TaskGraph): Promise<void> {
    const value = JSON.stringify(output.toJSON());
    await this.tabularRepository.put({ key, value });
    this.emit("graph_saved", key);
  }

  /**
   * Retrieves a task graph from persistent storage
   * @param key The unique identifier of the task graph to retrieve
   * @returns The retrieved task graph, or undefined if not found
   * @emits graph_retrieved when the operation completes successfully
   */
  async getTaskGraph(key: string): Promise<TaskGraph | undefined> {
    const result = await this.tabularRepository.get({ key });
    const value = result?.value;
    if (!value) {
      return undefined;
    }
    const jsonObj = JSON.parse(value);
    const graph = createGraphFromGraphJSON(jsonObj, this.registry);

    this.emit("graph_retrieved", key);
    return graph;
  }

  /**
   * Clears all task graphs from the repository
   * @emits graph_cleared when the operation completes
   */
  async clear(): Promise<void> {
    await this.tabularRepository.deleteAll();
    this.emit("graph_cleared");
  }

  /**
   * Returns the number of task graphs stored in the repository
   * @returns The count of stored task graphs
   */
  async size(): Promise<number> {
    return await this.tabularRepository.size();
  }
}
