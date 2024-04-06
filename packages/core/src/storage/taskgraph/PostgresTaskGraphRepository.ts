//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson } from "../../task/base/TaskGraph";
import { TaskGraphRepository } from "./TaskGraphRepository";
import { PostgresKVRepository } from "../base/PostgresKVRepository";

export class PostgresTaskGraphRepository extends TaskGraphRepository {
  kvRepository: PostgresKVRepository<unknown, TaskGraphJson>;

  constructor(connectionString: string) {
    super();
    this.kvRepository = new PostgresKVRepository<unknown, TaskGraphJson>(
      connectionString,
      "task_graphs"
    );
  }
}
