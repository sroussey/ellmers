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
import { PostgresKVRepository } from "./base/PostgresKVRepository";

export class PostgresTaskOutputRepository extends TaskOutputRepository {
  kvRepository: PostgresKVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
  public type = "PostgresTaskOutputRepository" as const;
  constructor(connectionString: string) {
    super();
    this.kvRepository = new PostgresKVRepository<
      TaskOutputPrimaryKey,
      DefaultValueType,
      typeof TaskOutputPrimaryKeySchema
    >(connectionString, "task_outputs", TaskOutputPrimaryKeySchema);
  }
}
