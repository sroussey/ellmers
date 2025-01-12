//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput, TaskOutputDiscriminator, TaskOutputRepository } from "ellmers-core";
import { PostgresKVRepository } from "./base/PostgresKVRepository";

export class PostgresTaskOutputRepository extends TaskOutputRepository {
  kvRepository: PostgresKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;
  public type = "PostgresTaskOutputRepository" as const;
  constructor(connectionString: string) {
    super();
    this.kvRepository = new PostgresKVRepository<
      TaskInput,
      TaskOutput,
      typeof TaskOutputDiscriminator
    >(connectionString, "task_outputs", TaskOutputDiscriminator);
  }
}
