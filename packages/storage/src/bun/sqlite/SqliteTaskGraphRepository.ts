//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "ellmers-core";
import { SqliteKVRepository } from "./base/SqliteKVRepository";

export class SqliteTaskGraphRepository extends TaskGraphRepository {
  kvRepository: SqliteKVRepository;
  public type = "SqliteTaskGraphRepository" as const;
  constructor(dbOrPath: string) {
    super();
    this.kvRepository = new SqliteKVRepository(dbOrPath, "task_graphs");
  }
}
