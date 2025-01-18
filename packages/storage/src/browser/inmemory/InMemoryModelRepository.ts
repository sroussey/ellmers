//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ModelPrimaryKey,
  ModelRepository,
  Task2ModelDetail,
  Task2ModelPrimaryKey,
} from "ellmers-ai";
import { InMemoryKVRepository } from "./base/InMemoryKVRepository";
import {
  ModelPrimaryKeySchema,
  Task2ModelPrimaryKeySchema,
  Task2ModelDetailSchema,
} from "ellmers-ai";
import { DefaultValueType } from "ellmers-core";

export class InMemoryModelRepository extends ModelRepository {
  modelKvRepository: InMemoryKVRepository<
    ModelPrimaryKey,
    DefaultValueType,
    typeof ModelPrimaryKeySchema
  >;
  task2ModelKvRepository: InMemoryKVRepository<
    Task2ModelPrimaryKey,
    Task2ModelDetail,
    typeof Task2ModelPrimaryKeySchema,
    typeof Task2ModelDetailSchema
  >;
  public type = "InMemoryModelRepository" as const;
  constructor() {
    super();
    this.modelKvRepository = new InMemoryKVRepository<
      ModelPrimaryKey,
      DefaultValueType,
      typeof ModelPrimaryKeySchema
    >(ModelPrimaryKeySchema);
    this.task2ModelKvRepository = new InMemoryKVRepository<
      Task2ModelPrimaryKey,
      Task2ModelDetail,
      typeof Task2ModelPrimaryKeySchema,
      typeof Task2ModelDetailSchema
    >(Task2ModelPrimaryKeySchema, Task2ModelDetailSchema, ["model"]);
  }
}
