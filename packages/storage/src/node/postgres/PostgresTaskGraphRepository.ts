//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "ellmers-core";
import { PostgresKVRepository } from "./base/PostgresKVRepository";

/**
 * PostgreSQL implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using PostgreSQL.
 */
export class PostgresTaskGraphRepository extends TaskGraphRepository {
  kvRepository: PostgresKVRepository;
  public type = "PostgresTaskGraphRepository" as const;
  constructor(connectionString: string) {
    super();
    this.kvRepository = new PostgresKVRepository(connectionString, "task_graphs");
  }
}
