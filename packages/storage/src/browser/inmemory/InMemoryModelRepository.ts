//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model, ModelRepository } from "ellmers-ai";
import { InMemoryKVRepository } from "./base/InMemoryKVRepository";
import { ModelPrimaryKeySchema } from "ellmers-ai";

export class InMemoryModelRepository extends ModelRepository {
  kvRepository: InMemoryKVRepository<unknown, Model, typeof ModelPrimaryKeySchema>;
  public type = "InMemoryModelRepository" as const;
  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository<unknown, Model, typeof ModelPrimaryKeySchema>();
  }
}
