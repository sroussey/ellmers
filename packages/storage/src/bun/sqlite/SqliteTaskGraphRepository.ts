//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson, TaskGraphRepository } from "ellmers-core";
import { SqliteKVRepository } from "./base/SqliteKVRepository";

export class SqliteTaskGraphRepository extends TaskGraphRepository {
  kvRepository: SqliteKVRepository<unknown, TaskGraphJson>;
  public type = "SqliteTaskGraphRepository" as const;
  constructor(dbOrPath: string) {
    super();
    this.kvRepository = new SqliteKVRepository<unknown, TaskGraphJson>(dbOrPath, "task_graphs");
  }
}
