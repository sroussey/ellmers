//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskOutputPrimaryKeySchema,
  TaskOutputRepository,
  TaskOutputPrimaryKey,
  DefaultValueType,
} from "ellmers-core";
import { SqliteKVRepository } from "./base/SqliteKVRepository";

/**
 * SQLite implementation of a task output repository.
 * Provides storage and retrieval for task outputs using SQLite.
 */
export class SqliteTaskOutputRepository extends TaskOutputRepository {
  kvRepository: SqliteKVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
  public type = "SqliteTaskOutputRepository" as const;
  constructor(dbOrPath: string) {
    super();
    this.kvRepository = new SqliteKVRepository<
      TaskOutputPrimaryKey,
      DefaultValueType,
      typeof TaskOutputPrimaryKeySchema
    >(dbOrPath, "task_outputs", TaskOutputPrimaryKeySchema);
  }
}
