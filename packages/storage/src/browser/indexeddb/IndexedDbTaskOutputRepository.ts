//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskInput,
  TaskOutput,
  TaskOutputPrimaryKeySchema,
  TaskOutputRepository,
} from "ellmers-core";
import { IndexedDbKVRepository } from "./base/IndexedDbKVRepository";

export class IndexedDbTaskOutputRepository extends TaskOutputRepository {
  kvRepository: IndexedDbKVRepository<TaskInput, TaskOutput, typeof TaskOutputPrimaryKeySchema>;
  public type = "IndexedDbTaskOutputRepository" as const;
  constructor() {
    super();
    this.kvRepository = new IndexedDbKVRepository<
      TaskInput,
      TaskOutput,
      typeof TaskOutputPrimaryKeySchema
    >("task_outputs");
  }
}
