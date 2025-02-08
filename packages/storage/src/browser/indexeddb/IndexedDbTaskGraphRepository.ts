//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "ellmers-core";
import { IndexedDbKVRepository } from "./base/IndexedDbKVRepository";

/**
 * IndexedDB implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using IndexedDB.
 */
export class IndexedDbTaskGraphRepository extends TaskGraphRepository {
  kvRepository: IndexedDbKVRepository;
  public type = "IndexedDbTaskGraphRepository" as const;
  constructor(table: string = "task_graphs") {
    super();
    this.kvRepository = new IndexedDbKVRepository(table);
  }
}
