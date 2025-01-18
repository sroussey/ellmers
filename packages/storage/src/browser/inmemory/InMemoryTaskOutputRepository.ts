//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  DefaultValueType,
  TaskInput,
  TaskOutput,
  TaskOutputPrimaryKey,
  TaskOutputPrimaryKeySchema,
  TaskOutputRepository,
} from "ellmers-core";
import { InMemoryKVRepository } from "./base/InMemoryKVRepository";

export class InMemoryTaskOutputRepository extends TaskOutputRepository {
  kvRepository: InMemoryKVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
  public type = "InMemoryTaskOutputRepository" as const;
  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository<
      TaskOutputPrimaryKey,
      DefaultValueType,
      typeof TaskOutputPrimaryKeySchema
    >(TaskOutputPrimaryKeySchema);
  }
}
