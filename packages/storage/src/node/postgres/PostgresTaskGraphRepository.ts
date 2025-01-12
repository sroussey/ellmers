//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson, TaskGraphRepository } from "ellmers-core";
import { PostgresKVRepository } from "./base/PostgresKVRepository";

export class PostgresTaskGraphRepository extends TaskGraphRepository {
  kvRepository: PostgresKVRepository<unknown, TaskGraphJson>;
  public type = "PostgresTaskGraphRepository" as const;
  constructor(connectionString: string) {
    super();
    this.kvRepository = new PostgresKVRepository<unknown, TaskGraphJson>(
      connectionString,
      "task_graphs"
    );
  }
}
