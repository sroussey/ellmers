//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson, TaskGraphRepository } from "ellmers-core";
import { InMemoryKVRepository } from "./InMemoryKVRepository";

export class InMemoryTaskGraphRepository extends TaskGraphRepository {
  kvRepository: InMemoryKVRepository<unknown, TaskGraphJson>;
  public type = "InMemoryTaskGraphRepository" as const;
  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository<unknown, TaskGraphJson>();
  }
}
