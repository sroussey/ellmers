//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "ellmers-core";
import { IndexedDbKVRepository } from "./base/IndexedDbKVRepository";

export class IndexedDbTaskGraphRepository extends TaskGraphRepository {
  kvRepository: IndexedDbKVRepository;
  public type = "IndexedDbTaskGraphRepository" as const;
  constructor() {
    super();
    this.kvRepository = new IndexedDbKVRepository("task_graphs");
  }
}
