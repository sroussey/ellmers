//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  DefaultValueType,
  TaskOutputPrimaryKey,
  TaskOutputPrimaryKeySchema,
  TaskOutputRepository,
} from "ellmers-core";
import { IndexedDbKVRepository } from "./base/IndexedDbKVRepository";

/**
 * IndexedDB implementation of a task output repository.
 * Provides storage and retrieval for task outputs using IndexedDB.
 */
export class IndexedDbTaskOutputRepository extends TaskOutputRepository {
  kvRepository: IndexedDbKVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
  public type = "IndexedDbTaskOutputRepository" as const;
  constructor(table: string = "task_outputs") {
    super();
    this.kvRepository = new IndexedDbKVRepository<
      TaskOutputPrimaryKey,
      DefaultValueType,
      typeof TaskOutputPrimaryKeySchema
    >(table, TaskOutputPrimaryKeySchema);
  }
}
