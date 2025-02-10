//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "@ellmers/task-graph";
import { SqliteKVRepository } from "./base/SqliteKVRepository";

/**
 * SQLite implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using SQLite.
 */
export class SqliteTaskGraphRepository extends TaskGraphRepository {
  kvRepository: SqliteKVRepository;
  public type = "SqliteTaskGraphRepository" as const;
  constructor(dbOrPath: string, table: string = "task_graphs") {
    super();
    this.kvRepository = new SqliteKVRepository(dbOrPath, table);
  }
}
