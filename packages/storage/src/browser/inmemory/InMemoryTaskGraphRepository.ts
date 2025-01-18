//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "ellmers-core";
import { InMemoryKVRepository } from "./base/InMemoryKVRepository";

/**
 * In-memory implementation of a task graph repository.
 * Provides storage and retrieval for task graphs.
 */
export class InMemoryTaskGraphRepository extends TaskGraphRepository {
  kvRepository: InMemoryKVRepository;
  public type = "InMemoryTaskGraphRepository" as const;
  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository();
  }
}
