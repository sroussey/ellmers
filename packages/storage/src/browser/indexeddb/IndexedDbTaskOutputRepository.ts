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

export class IndexedDbTaskOutputRepository extends TaskOutputRepository {
  kvRepository: IndexedDbKVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
  public type = "IndexedDbTaskOutputRepository" as const;
  constructor() {
    super();
    this.kvRepository = new IndexedDbKVRepository<
      TaskOutputPrimaryKey,
      DefaultValueType,
      typeof TaskOutputPrimaryKeySchema
    >("task_outputs", TaskOutputPrimaryKeySchema);
  }
}
