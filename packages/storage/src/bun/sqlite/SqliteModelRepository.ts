//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ModelRepository,
  ModelPrimaryKeySchema,
  ModelPrimaryKey,
  Task2ModelDetailSchema,
  Task2ModelPrimaryKey,
  Task2ModelDetail,
  Task2ModelPrimaryKeySchema,
} from "ellmers-ai";
import { SqliteKVRepository } from "./base/SqliteKVRepository";
import { DefaultValueType } from "ellmers-core";

/**
 * SQLite implementation of a model repository.
 * Provides storage and retrieval for models and task-to-model mappings using SQLite.
 */
export class SqliteModelRepository extends ModelRepository {
  public type = "SqliteModelRepository" as const;
  modelKvRepository: SqliteKVRepository<
    ModelPrimaryKey,
    DefaultValueType,
    typeof ModelPrimaryKeySchema
  >;
  task2ModelKvRepository: SqliteKVRepository<
    Task2ModelPrimaryKey,
    Task2ModelDetail,
    typeof Task2ModelPrimaryKeySchema,
    typeof Task2ModelDetailSchema
  >;
  constructor(dbOrPath: string) {
    super();
    this.modelKvRepository = new SqliteKVRepository<
      ModelPrimaryKey,
      DefaultValueType,
      typeof ModelPrimaryKeySchema
    >(dbOrPath, "aimodel", ModelPrimaryKeySchema);
    this.task2ModelKvRepository = new SqliteKVRepository<
      Task2ModelPrimaryKey,
      Task2ModelDetail,
      typeof Task2ModelPrimaryKeySchema,
      typeof Task2ModelDetailSchema
    >(dbOrPath, "aitask2aimodel", Task2ModelPrimaryKeySchema, Task2ModelDetailSchema);
  }
}
