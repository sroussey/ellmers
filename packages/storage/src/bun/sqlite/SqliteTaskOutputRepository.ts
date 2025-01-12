//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskOutputDiscriminator, TaskOutputRepository, TaskInput, TaskOutput } from "ellmers-core";
import { SqliteKVRepository } from "./base/SqliteKVRepository";

export class SqliteTaskOutputRepository extends TaskOutputRepository {
  kvRepository: SqliteKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;
  public type = "SqliteTaskOutputRepository" as const;
  constructor(dbOrPath: string) {
    super();
    this.kvRepository = new SqliteKVRepository<
      TaskInput,
      TaskOutput,
      typeof TaskOutputDiscriminator
    >(dbOrPath, "task_outputs", TaskOutputDiscriminator);
  }
}
